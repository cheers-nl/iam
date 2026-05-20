import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';

const TABLE_NAME = process.env.TABLE_NAME!;
const KMS_KEY_ID = process.env.KMS_KEY_ID!;
const USER_POOL_ID = process.env.USER_POOL_ID!;
const ADMIN_GROUP = 'vault-admin';
const MEMBER_GROUP = 'vault-member';
const MAX_SECRET_BYTES = 4096;
const MAX_TITLE_BYTES = 160;
const MAX_NOTES_BYTES = 2048;

// CORS allowlist — tighter than wildcard. CDK owns the deployed CloudFront
// domain and passes it here so this handler does not drift if the distribution
// is recreated. API Gateway's preflight + gateway responses are configured
// separately in CDK.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const DEFAULT_ALLOWED_ORIGIN = ALLOWED_ORIGINS[0] ?? 'http://localhost:5173';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});
const cognito = new CognitoIdentityProviderClient({});

const TEAM_PK = 'TEAM#default';

const skForSecret = (id: string) => `SECRET#${id}`;
const skForAudit = (timestamp: string, eventId: string) =>
  `AUDIT#${timestamp}#${eventId}`;

export function pickAllowedOrigin(event: APIGatewayProxyEvent): string {
  const headers = event.headers ?? {};
  const origin = (headers['origin'] ?? headers['Origin'] ?? '') as string;
  return ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ALLOWED_ORIGIN;
}

function json(
  statusCode: number,
  body: unknown,
  allowedOrigin: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Vary': 'Origin',
    },
    body: JSON.stringify(body),
  };
}

type Claims = {
  sub?: string;
  email?: string;
  'cognito:groups'?: string | string[];
};

function extractClaims(event: APIGatewayProxyEvent): Claims | null {
  return ((event.requestContext as any)?.authorizer?.claims as Claims) ?? null;
}

export function getGroups(claims: Claims): string[] {
  const raw = claims['cognito:groups'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.replace(/^\[|\]$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

export function isAdmin(claims: Claims): boolean {
  return getGroups(claims).includes(ADMIN_GROUP);
}

// Defense-in-depth: every authenticated endpoint that returns vault data
// requires the caller to be in vault-admin OR vault-member. Without this,
// anyone who can sign up to the user pool (or any leftover ungrouped test
// user) would see and reveal team secrets.
export function isMemberOrAdmin(claims: Claims): boolean {
  const groups = getGroups(claims);
  return groups.includes(ADMIN_GROUP) || groups.includes(MEMBER_GROUP);
}

type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptedDek: string;
};

type AuditAction = 'CREATE' | 'REVEAL' | 'DELETE' | 'INVITE';

function parseJsonBody(event: APIGatewayProxyEvent): Record<string, unknown> {
  try {
    const parsed = JSON.parse(event.body ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('request body must be valid JSON');
  }
}

function optionalString(value: unknown, maxBytes: number, fieldName: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${fieldName} must be ${maxBytes} bytes or less`);
  }
  return value;
}

async function encryptValue(plaintext: string): Promise<EncryptedPayload> {
  const dataKeyResp = await kms.send(
    new GenerateDataKeyCommand({
      KeyId: KMS_KEY_ID,
      KeySpec: 'AES_256',
      EncryptionContext: { team: 'default' },
    })
  );
  const plainDek = dataKeyResp.Plaintext as Uint8Array;
  const encryptedDek = dataKeyResp.CiphertextBlob as Uint8Array;
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', plainDek, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      encryptedDek: Buffer.from(encryptedDek).toString('base64'),
    };
  } finally {
    plainDek.fill(0);
  }
}

async function decryptValue(payload: EncryptedPayload): Promise<string> {
  const decryptResp = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(payload.encryptedDek, 'base64'),
      EncryptionContext: { team: 'default' },
    })
  );
  const plainDek = decryptResp.Plaintext as Uint8Array;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      plainDek,
      Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } finally {
    plainDek.fill(0);
  }
}

async function writeAudit(
  action: AuditAction,
  secretId: string,
  secretTitle: string,
  actorSub: string,
  actorEmail: string | undefined,
  metadata?: Record<string, unknown>
): Promise<void> {
  const now = new Date().toISOString();
  const eventId = randomUUID();
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: TEAM_PK,
        sk: skForAudit(now, eventId),
        eventId,
        action,
        secretId,
        secretTitle,
        actorSub,
        actorEmail: actorEmail ?? null,
        timestamp: now,
        ...(metadata ?? {}),
      },
    })
  );
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const origin = pickAllowedOrigin(event);

  const claims = extractClaims(event);
  if (!claims?.sub) {
    return json(401, { error: 'missing sub in JWT claims' }, origin);
  }

  const resource = event.resource;
  const method = event.httpMethod;

  try {
    if (resource === '/secrets' && method === 'POST') return await createSecret(claims, event, origin);
    if (resource === '/secrets' && method === 'GET') return await listSecrets(claims, origin);
    if (resource === '/secrets/{id}' && method === 'GET') return await getSecret(claims, event.pathParameters?.id, origin);
    if (resource === '/secrets/{id}' && method === 'DELETE') return await deleteSecret(claims, event.pathParameters?.id, origin);
    if (resource === '/audit' && method === 'GET') return await listAudit(claims, origin);
    if (resource === '/members' && method === 'GET') return await listMembers(claims, origin);
    if (resource === '/members' && method === 'POST') return await inviteMember(claims, event, origin);
    if (resource === '/me' && method === 'GET') return await whoAmI(claims, origin);

    return json(404, { error: 'route not found', resource, method }, origin);
  } catch (err: any) {
    console.error('handler error', err);
    return json(500, { error: err?.message ?? 'internal error', name: err?.name }, origin);
  }
};

async function whoAmI(claims: Claims, origin: string): Promise<APIGatewayProxyResult> {
  return json(
    200,
    {
      sub: claims.sub,
      email: claims.email,
      groups: getGroups(claims),
      isAdmin: isAdmin(claims),
      hasVaultAccess: isMemberOrAdmin(claims),
    },
    origin
  );
}

export async function createSecret(
  claims: Claims,
  event: APIGatewayProxyEvent,
  origin: string
): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to create secrets' }, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = parseJsonBody(event);
  } catch (err: any) {
    return json(400, { error: err.message }, origin);
  }

  const { title, loginUrl, usernameHint, password, category, notes } = body;
  if (typeof title !== 'string' || !title.trim() || typeof password !== 'string' || !password) {
    return json(400, { error: 'title and password are required strings' }, origin);
  }
  if (Buffer.byteLength(title, 'utf8') > MAX_TITLE_BYTES) {
    return json(400, { error: `title must be ${MAX_TITLE_BYTES} bytes or less` }, origin);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_SECRET_BYTES) {
    return json(400, { error: `password must be ${MAX_SECRET_BYTES} bytes or less` }, origin);
  }

  let cleanLoginUrl: string | null;
  let cleanUsernameHint: string | null;
  let cleanNotes: string | null;
  try {
    cleanLoginUrl = optionalString(loginUrl, 512, 'loginUrl');
    cleanUsernameHint = optionalString(usernameHint, 256, 'usernameHint');
    cleanNotes = optionalString(notes, MAX_NOTES_BYTES, 'notes');
  } catch (err: any) {
    return json(400, { error: err.message }, origin);
  }
  const cleanCategory = typeof category === 'string' && category ? category : 'GENERAL';
  const cleanTitle = title.trim();

  if (Buffer.byteLength(cleanCategory, 'utf8') > 64) {
    return json(400, { error: 'category must be 64 bytes or less' }, origin);
  }

  const secretId = randomUUID();
  const now = new Date().toISOString();
  const encrypted = await encryptValue(password);

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: TEAM_PK,
        sk: skForSecret(secretId),
        secretId,
        title: cleanTitle,
        loginUrl: cleanLoginUrl,
        usernameHint: cleanUsernameHint,
        category: cleanCategory,
        notes: cleanNotes,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        encryptedDek: encrypted.encryptedDek,
        createdAt: now,
        createdBy: claims.sub,
      },
    })
  );

  await writeAudit('CREATE', secretId, cleanTitle, claims.sub!, claims.email);

  return json(201, { id: secretId, title: cleanTitle, createdAt: now }, origin);
}

export async function listSecrets(claims: Claims, origin: string): Promise<APIGatewayProxyResult> {
  if (!isMemberOrAdmin(claims)) {
    return json(403, { error: 'vault membership required' }, origin);
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': TEAM_PK,
        ':skPrefix': 'SECRET#',
      },
      ProjectionExpression: 'secretId, title, loginUrl, category, createdAt',
    })
  );

  const items = (result.Items ?? []).map((it) => ({
    id: it.secretId,
    title: it.title,
    loginUrl: it.loginUrl,
    category: it.category,
    createdAt: it.createdAt,
  }));

  return json(200, { secrets: items }, origin);
}

export async function getSecret(
  claims: Claims,
  secretId: string | undefined,
  origin: string
): Promise<APIGatewayProxyResult> {
  if (!isMemberOrAdmin(claims)) {
    return json(403, { error: 'vault membership required' }, origin);
  }
  if (!secretId) return json(400, { error: 'id required' }, origin);

  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: TEAM_PK, sk: skForSecret(secretId) },
    })
  );

  if (!result.Item) {
    return json(404, { error: 'not found' }, origin);
  }

  const item = result.Item;
  if (!item.ciphertext || !item.iv || !item.authTag || !item.encryptedDek) {
    return json(
      410,
      { error: 'Legacy plaintext row from before envelope encryption — please recreate.' },
      origin
    );
  }
  const password = await decryptValue({
    ciphertext: item.ciphertext,
    iv: item.iv,
    authTag: item.authTag,
    encryptedDek: item.encryptedDek,
  });

  await writeAudit('REVEAL', secretId, item.title, claims.sub!, claims.email);

  return json(
    200,
    {
      id: item.secretId,
      title: item.title,
      loginUrl: item.loginUrl,
      usernameHint: item.usernameHint,
      category: item.category,
      notes: item.notes,
      password,
      createdAt: item.createdAt,
    },
    origin
  );
}

export async function deleteSecret(
  claims: Claims,
  secretId: string | undefined,
  origin: string
): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to delete secrets' }, origin);
  }
  if (!secretId) return json(400, { error: 'id required' }, origin);

  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: TEAM_PK, sk: skForSecret(secretId) },
      ProjectionExpression: 'title',
    })
  );
  if (!existing.Item) {
    return json(404, { error: 'not found' }, origin);
  }

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: TEAM_PK, sk: skForSecret(secretId) },
    })
  );

  await writeAudit('DELETE', secretId, existing.Item.title, claims.sub!, claims.email);

  return json(200, { id: secretId, deleted: true }, origin);
}

export async function listAudit(claims: Claims, origin: string): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to view audit log' }, origin);
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': TEAM_PK,
        ':skPrefix': 'AUDIT#',
      },
      ScanIndexForward: false,
      Limit: 100,
    })
  );

  const events = (result.Items ?? []).map((it) => ({
    eventId: it.eventId,
    action: it.action,
    secretId: it.secretId,
    secretTitle: it.secretTitle,
    actorEmail: it.actorEmail,
    actorSub: it.actorSub,
    timestamp: it.timestamp,
  }));

  return json(200, { events }, origin);
}

export async function listMembers(claims: Claims, origin: string): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to list members' }, origin);
  }

  const [admins, members] = await Promise.all([
    cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: ADMIN_GROUP })),
    cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: MEMBER_GROUP })),
  ]);

  const mapUser = (role: string) => (u: any) => ({
    username: u.Username,
    email: u.Attributes?.find((a: any) => a.Name === 'email')?.Value,
    status: u.UserStatus,
    role,
    createdAt: u.UserCreateDate,
  });

  const all = [
    ...(admins.Users ?? []).map(mapUser('admin')),
    ...(members.Users ?? []).map(mapUser('member')),
  ];

  return json(200, { members: all }, origin);
}

export async function inviteMember(
  claims: Claims,
  event: APIGatewayProxyEvent,
  origin: string
): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to invite members' }, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = parseJsonBody(event);
  } catch (err: any) {
    return json(400, { error: err.message }, origin);
  }

  const { email, role } = body;
  if (typeof email !== 'string' || !email.trim() || typeof role !== 'string') {
    return json(400, { error: 'email and role required' }, origin);
  }
  if (role !== 'admin' && role !== 'member') {
    return json(400, { error: 'role must be "admin" or "member"' }, origin);
  }

  const groupName = role === 'admin' ? ADMIN_GROUP : MEMBER_GROUP;
  const normalizedEmail = email.trim().toLowerCase();

  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: normalizedEmail,
        UserAttributes: [
          { Name: 'email', Value: normalizedEmail },
          { Name: 'email_verified', Value: 'true' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      })
    );
  } catch (err: any) {
    if (err?.name === 'UsernameExistsException') {
      return json(409, { error: 'user already exists', email: normalizedEmail }, origin);
    }
    throw err;
  }

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: normalizedEmail,
      GroupName: groupName,
    })
  );

  await writeAudit(
    'INVITE',
    normalizedEmail,
    `Invited ${normalizedEmail} as ${role}`,
    claims.sub!,
    claims.email,
    { invitedEmail: normalizedEmail, invitedRole: role }
  );

  return json(201, { email: normalizedEmail, role, status: 'invited' }, origin);
}

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
  AdminGetUserCommand,
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

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});
const cognito = new CognitoIdentityProviderClient({});

// Single shared team vault. All authenticated members share the same logical
// space — matches the 'team password manager' product model (1Password Business
// shared vault, Stellen GroupSecret). Cross-team isolation is enforced via the
// PK prefix; cross-role authorization is enforced via Cognito groups in claims.
const TEAM_PK = 'TEAM#default';

const skForSecret = (id: string) => `SECRET#${id}`;
const skForAudit = (timestamp: string, eventId: string) =>
  `AUDIT#${timestamp}#${eventId}`;

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  },
  body: JSON.stringify(body),
});

type Claims = {
  sub?: string;
  email?: string;
  'cognito:groups'?: string | string[];
};

function extractClaims(event: APIGatewayProxyEvent): Claims | null {
  return ((event.requestContext as any)?.authorizer?.claims as Claims) ?? null;
}

function getGroups(claims: Claims): string[] {
  // Cognito sends groups as a JSON-serialized string sometimes ("[admin,member]")
  // and as an actual array other times — depends on authorizer version.
  const raw = claims['cognito:groups'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    // Forms: "vault-admin" or "[vault-admin vault-member]" or "[vault-admin,vault-member]"
    const trimmed = raw.replace(/^\[|\]$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

function isAdmin(claims: Claims): boolean {
  return getGroups(claims).includes(ADMIN_GROUP);
}

type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  authTag: string;
  encryptedDek: string;
};

type AuditAction = 'CREATE' | 'REVEAL' | 'DELETE' | 'INVITE';

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
  const claims = extractClaims(event);
  if (!claims?.sub) {
    return json(401, { error: 'missing sub in JWT claims' });
  }

  const resource = event.resource;
  const method = event.httpMethod;

  try {
    if (resource === '/secrets' && method === 'POST') return await createSecret(claims, event);
    if (resource === '/secrets' && method === 'GET') return await listSecrets();
    if (resource === '/secrets/{id}' && method === 'GET') return await getSecret(claims, event.pathParameters?.id);
    if (resource === '/secrets/{id}' && method === 'DELETE') return await deleteSecret(claims, event.pathParameters?.id);
    if (resource === '/audit' && method === 'GET') return await listAudit(claims);
    if (resource === '/members' && method === 'GET') return await listMembers(claims);
    if (resource === '/members' && method === 'POST') return await inviteMember(claims, event);
    if (resource === '/me' && method === 'GET') return await whoAmI(claims);

    return json(404, { error: 'route not found', resource, method });
  } catch (err: any) {
    console.error('handler error', err);
    return json(500, { error: err?.message ?? 'internal error', name: err?.name });
  }
};

async function whoAmI(claims: Claims): Promise<APIGatewayProxyResult> {
  return json(200, {
    sub: claims.sub,
    email: claims.email,
    groups: getGroups(claims),
    isAdmin: isAdmin(claims),
  });
}

async function createSecret(
  claims: Claims,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to create secrets' });
  }

  const body = JSON.parse(event.body ?? '{}');
  const { title, loginUrl, usernameHint, password, category, notes } = body;
  if (!title || !password) {
    return json(400, { error: 'title and password are required' });
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
        title,
        loginUrl: loginUrl ?? null,
        usernameHint: usernameHint ?? null,
        category: category ?? 'GENERAL',
        notes: notes ?? null,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        encryptedDek: encrypted.encryptedDek,
        createdAt: now,
        createdBy: claims.sub,
      },
    })
  );

  await writeAudit('CREATE', secretId, title, claims.sub!, claims.email);

  return json(201, { id: secretId, title, createdAt: now });
}

async function listSecrets(): Promise<APIGatewayProxyResult> {
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

  return json(200, { secrets: items });
}

async function getSecret(
  claims: Claims,
  secretId: string | undefined
): Promise<APIGatewayProxyResult> {
  if (!secretId) return json(400, { error: 'id required' });

  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: TEAM_PK, sk: skForSecret(secretId) },
    })
  );

  if (!result.Item) {
    return json(404, { error: 'not found' });
  }

  const item = result.Item;
  if (!item.ciphertext || !item.iv || !item.authTag || !item.encryptedDek) {
    return json(410, {
      error: 'Legacy plaintext row from before envelope encryption — please recreate.',
    });
  }
  const password = await decryptValue({
    ciphertext: item.ciphertext,
    iv: item.iv,
    authTag: item.authTag,
    encryptedDek: item.encryptedDek,
  });

  await writeAudit('REVEAL', secretId, item.title, claims.sub!, claims.email);

  return json(200, {
    id: item.secretId,
    title: item.title,
    loginUrl: item.loginUrl,
    usernameHint: item.usernameHint,
    category: item.category,
    notes: item.notes,
    password,
    createdAt: item.createdAt,
  });
}

async function deleteSecret(
  claims: Claims,
  secretId: string | undefined
): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to delete secrets' });
  }
  if (!secretId) return json(400, { error: 'id required' });

  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: TEAM_PK, sk: skForSecret(secretId) },
      ProjectionExpression: 'title',
    })
  );
  if (!existing.Item) {
    return json(404, { error: 'not found' });
  }

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: TEAM_PK, sk: skForSecret(secretId) },
    })
  );

  await writeAudit('DELETE', secretId, existing.Item.title, claims.sub!, claims.email);

  return json(200, { id: secretId, deleted: true });
}

async function listAudit(claims: Claims): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to view audit log' });
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

  return json(200, { events });
}

async function listMembers(claims: Claims): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to list members' });
  }

  // Fetch admins and members in parallel.
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

  return json(200, { members: all });
}

async function inviteMember(
  claims: Claims,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if (!isAdmin(claims)) {
    return json(403, { error: 'admin role required to invite members' });
  }

  const body = JSON.parse(event.body ?? '{}');
  const { email, role } = body;
  if (!email || !role) {
    return json(400, { error: 'email and role required' });
  }
  if (role !== 'admin' && role !== 'member') {
    return json(400, { error: 'role must be "admin" or "member"' });
  }

  const groupName = role === 'admin' ? ADMIN_GROUP : MEMBER_GROUP;

  // Create the user (Cognito sends invitation email automatically).
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    })
  );

  // Add the new user to the appropriate group.
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      GroupName: groupName,
    })
  );

  await writeAudit(
    'INVITE',
    email,
    `Invited ${email} as ${role}`,
    claims.sub!,
    claims.email,
    { invitedEmail: email, invitedRole: role }
  );

  return json(201, { email, role, status: 'invited' });
}

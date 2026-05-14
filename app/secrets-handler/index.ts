import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';

const TABLE_NAME = process.env.TABLE_NAME!;
const KMS_KEY_ID = process.env.KMS_KEY_ID!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});

const pkForUser = (sub: string) => `USER#${sub}`;
const skForSecret = (secretId: string) => `SECRET#${secretId}`;

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    // CORS headers must be on the actual response, not just on the OPTIONS
    // preflight. defaultCorsPreflightOptions in CDK handles preflight only.
    // For Lambda proxy integration, the function is responsible for these.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  },
  body: JSON.stringify(body),
});

type EncryptedPayload = {
  ciphertext: string; // base64
  iv: string;         // base64
  authTag: string;    // base64
  encryptedDek: string; // base64
};

async function encryptValue(plaintext: string, sub: string): Promise<EncryptedPayload> {
  // Step 1: ask KMS to generate a data key. Returns plaintext DEK + encrypted DEK.
  const dataKeyResp = await kms.send(
    new GenerateDataKeyCommand({
      KeyId: KMS_KEY_ID,
      KeySpec: 'AES_256',
      // Encryption context binds the encrypted DEK to a specific user.
      // Decrypt will only succeed if the same context is presented.
      EncryptionContext: { userSub: sub },
    })
  );

  const plainDek = dataKeyResp.Plaintext as Uint8Array;
  const encryptedDek = dataKeyResp.CiphertextBlob as Uint8Array;
  const iv = randomBytes(12); // GCM standard IV length

  try {
    // Step 2: AES-256-GCM encrypt locally with the plain DEK.
    const cipher = createCipheriv('aes-256-gcm', plainDek, iv);
    const ciphertextChunks = [
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ];
    const ciphertext = Buffer.concat(ciphertextChunks);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      encryptedDek: Buffer.from(encryptedDek).toString('base64'),
    };
  } finally {
    // Step 3: destroy plain DEK in memory.
    // (Node doesn't let us zero a Uint8Array reliably across GC, but
    // overwriting reduces the window during which it sits in memory.)
    plainDek.fill(0);
  }
}

async function decryptValue(payload: EncryptedPayload, sub: string): Promise<string> {
  // Step 1: ask KMS to decrypt the encrypted DEK.
  const decryptResp = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(payload.encryptedDek, 'base64'),
      EncryptionContext: { userSub: sub },
    })
  );
  const plainDek = decryptResp.Plaintext as Uint8Array;

  try {
    // Step 2: AES-256-GCM decrypt locally.
    const decipher = createDecipheriv(
      'aes-256-gcm',
      plainDek,
      Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const plaintextChunks = [
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ];
    return Buffer.concat(plaintextChunks).toString('utf8');
  } finally {
    plainDek.fill(0);
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const claims = (event.requestContext as any)?.authorizer?.claims;
  const sub = claims?.sub;
  if (!sub) {
    return json(401, { error: 'missing sub in JWT claims' });
  }

  const resource = event.resource;
  const method = event.httpMethod;

  try {
    if (resource === '/secrets' && method === 'POST') {
      return await createSecret(sub, event);
    }
    if (resource === '/secrets' && method === 'GET') {
      return await listSecrets(sub);
    }
    if (resource === '/secrets/{id}' && method === 'GET') {
      return await getSecret(sub, event.pathParameters?.id);
    }
    return json(404, { error: 'route not found', resource, method });
  } catch (err: any) {
    console.error('handler error', err);
    return json(500, { error: err?.message ?? 'internal error', name: err?.name });
  }
};

async function createSecret(
  sub: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body ?? '{}');
  const { title, loginUrl, usernameHint, password, category, notes } = body;
  if (!title || !password) {
    return json(400, { error: 'title and password are required' });
  }

  const secretId = randomUUID();
  const now = new Date().toISOString();
  const encrypted = await encryptValue(password, sub);

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: pkForUser(sub),
        sk: skForSecret(secretId),
        secretId,
        title,
        loginUrl: loginUrl ?? null,
        usernameHint: usernameHint ?? null,
        category: category ?? 'GENERAL',
        notes: notes ?? null,
        // Envelope-encrypted password fields:
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        encryptedDek: encrypted.encryptedDek,
        createdAt: now,
        createdBy: sub,
      },
    })
  );

  return json(201, { id: secretId, title, createdAt: now });
}

async function listSecrets(sub: string): Promise<APIGatewayProxyResult> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': pkForUser(sub),
        ':skPrefix': 'SECRET#',
      },
      // Metadata only; never include ciphertext on list.
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
  sub: string,
  secretId: string | undefined
): Promise<APIGatewayProxyResult> {
  if (!secretId) return json(400, { error: 'id required' });

  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: pkForUser(sub), sk: skForSecret(secretId) },
    })
  );

  if (!result.Item) {
    return json(404, { error: 'not found' });
  }

  const item = result.Item;
  if (!item.ciphertext || !item.iv || !item.authTag || !item.encryptedDek) {
    return json(410, {
      error:
        'This secret was created before envelope encryption was enabled (legacy plaintext row). Please recreate it.',
    });
  }
  const password = await decryptValue(
    {
      ciphertext: item.ciphertext,
      iv: item.iv,
      authTag: item.authTag,
      encryptedDek: item.encryptedDek,
    },
    sub
  );

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

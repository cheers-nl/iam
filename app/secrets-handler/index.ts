import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';

const TABLE_NAME = process.env.TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const pkForUser = (sub: string) => `USER#${sub}`;
const skForSecret = (secretId: string) => `SECRET#${secretId}`;

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

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
    return json(500, { error: err?.message ?? 'internal error' });
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
        // NOTE: D4 stores password in plaintext. D5 will switch to KMS envelope encryption.
        password,
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
      // Return only metadata — never password — on list.
      ProjectionExpression:
        'secretId, title, loginUrl, category, createdAt',
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

  return json(200, {
    id: result.Item.secretId,
    title: result.Item.title,
    loginUrl: result.Item.loginUrl,
    usernameHint: result.Item.usernameHint,
    category: result.Item.category,
    notes: result.Item.notes,
    // D4 returns plaintext password — D5 will decrypt via KMS.
    password: result.Item.password,
    createdAt: result.Item.createdAt,
  });
}

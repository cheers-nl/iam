import type { APIGatewayProxyEvent } from 'aws-lambda';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import {
  createSecret,
  deleteSecret,
  getGroups,
  getSecret,
  inviteMember,
  isAdmin,
  isMemberOrAdmin,
  listAudit,
  listSecrets,
  pickAllowedOrigin,
} from './index';

const ORIGIN = 'https://demo.example.com';

const adminClaims = {
  sub: 'admin-sub',
  email: 'admin@example.com',
  'cognito:groups': 'vault-admin',
};

const memberClaims = {
  sub: 'member-sub',
  email: 'member@example.com',
  'cognito:groups': 'vault-member',
};

const ungroupedClaims = {
  sub: 'ungrouped-sub',
  email: 'ungrouped@example.com',
};

function eventWithBody(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/',
    requestContext: {} as any,
  };
}

describe('secrets handler authorization helpers', () => {
  test('parses Cognito groups from string and array claims', () => {
    expect(getGroups({ 'cognito:groups': 'vault-admin vault-member' })).toEqual([
      'vault-admin',
      'vault-member',
    ]);
    expect(getGroups({ 'cognito:groups': ['vault-member'] })).toEqual(['vault-member']);
  });

  test('classifies admin and member roles', () => {
    expect(isAdmin(adminClaims)).toBe(true);
    expect(isMemberOrAdmin(adminClaims)).toBe(true);
    expect(isMemberOrAdmin(memberClaims)).toBe(true);
    expect(isAdmin(memberClaims)).toBe(false);
    expect(isMemberOrAdmin(ungroupedClaims)).toBe(false);
  });

  test('falls back to the configured default CORS origin', () => {
    expect(pickAllowedOrigin(eventWithBody({}))).toBe('http://localhost:5173');
  });
});

describe('secrets handler route authorization', () => {
  test('ungrouped users cannot list or reveal vault secrets', async () => {
    await expect(listSecrets(ungroupedClaims, ORIGIN)).resolves.toMatchObject({ statusCode: 403 });
    await expect(getSecret(ungroupedClaims, 'secret-1', ORIGIN)).resolves.toMatchObject({ statusCode: 403 });
  });

  test('members cannot mutate secrets or view admin-only surfaces', async () => {
    const createEvent = eventWithBody({ title: 'Demo', password: 'secret' });
    const inviteEvent = eventWithBody({ email: 'new@example.com', role: 'member' });

    await expect(createSecret(memberClaims, createEvent, ORIGIN)).resolves.toMatchObject({ statusCode: 403 });
    await expect(deleteSecret(memberClaims, 'secret-1', ORIGIN)).resolves.toMatchObject({ statusCode: 403 });
    await expect(listAudit(memberClaims, ORIGIN)).resolves.toMatchObject({ statusCode: 403 });
    await expect(inviteMember(memberClaims, inviteEvent, ORIGIN)).resolves.toMatchObject({ statusCode: 403 });
  });

  test('admin create rejects invalid JSON before touching KMS or DynamoDB', async () => {
    const badEvent = { ...eventWithBody({}), body: '{bad json' };

    await expect(createSecret(adminClaims, badEvent, ORIGIN)).resolves.toMatchObject({
      statusCode: 400,
    });
  });

  test('admin create enforces secret size limits before touching KMS or DynamoDB', async () => {
    const oversized = 'x'.repeat(4097);
    const createEvent = eventWithBody({ title: 'Oversized', password: oversized });

    const response = await createSecret(adminClaims, createEvent, ORIGIN);

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('4096');
  });

  test('duplicate invites return 409 instead of surfacing a 500', async () => {
    const usernameExists = Object.assign(new Error('already exists'), {
      name: 'UsernameExistsException',
    });
    const sendSpy = jest
      .spyOn(CognitoIdentityProviderClient.prototype, 'send')
      .mockRejectedValueOnce(usernameExists as never);

    const response = await inviteMember(
      adminClaims,
      eventWithBody({ email: 'Existing@Example.com', role: 'member' }),
      ORIGIN
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toContain('existing@example.com');
    sendSpy.mockRestore();
  });
});

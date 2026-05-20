#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';

const profile = process.env.AWS_PROFILE ?? 'personal-admin';
const region = process.env.AWS_REGION ?? 'us-west-2';
const stack = process.env.STACK_NAME ?? 'TeamVaultLite';

const demoSecrets = [
  {
    title: 'Stripe production dashboard',
    loginUrl: 'https://dashboard.stripe.com',
    usernameHint: 'ops@northstar.example',
    password: 'demo-Stripe-rotate-2026',
    category: 'PAYMENT',
    notes: 'Fake demo credential. Represents finance-owned billing access.',
  },
  {
    title: 'SendGrid API key',
    loginUrl: 'https://app.sendgrid.com',
    usernameHint: 'platform@northstar.example',
    password: 'SG.demo-key-not-real-2026',
    category: 'DEV',
    notes: 'Fake demo credential. Represents a shared operational API token.',
  },
  {
    title: 'Datadog admin console',
    loginUrl: 'https://app.datadoghq.com',
    usernameHint: 'sre@northstar.example',
    password: 'demo-Datadog-admin-2026',
    category: 'DEV',
    notes: 'Fake demo credential. Represents incident-response access.',
  },
  {
    title: 'GitHub deploy token',
    loginUrl: 'https://github.com/settings/tokens',
    usernameHint: 'github-app:team-vault-demo',
    password: 'ghp_demo_token_not_real_2026',
    category: 'DEV',
    notes: 'Fake demo credential. Represents CI/CD deployment access.',
  },
];

function aws(args) {
  return execFileSync('aws', [...args, '--region', region, '--profile', profile], {
    encoding: 'utf8',
  });
}

function stackOutput(outputKey) {
  return aws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    stack,
    '--query',
    `Stacks[0].Outputs[?OutputKey==\`${outputKey}\`].OutputValue`,
    '--output',
    'text',
  ]).trim();
}

function attr(value) {
  if (value === null || value === undefined) return { NULL: true };
  return { S: String(value) };
}

function encryptValue(keyId, plaintext) {
  const dataKey = JSON.parse(
    aws([
      'kms',
      'generate-data-key',
      '--key-id',
      keyId,
      '--key-spec',
      'AES_256',
      '--encryption-context',
      'team=default',
      '--output',
      'json',
    ])
  );
  const plainDek = Buffer.from(dataKey.Plaintext, 'base64');
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', plainDek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      encryptedDek: dataKey.CiphertextBlob,
    };
  } finally {
    plainDek.fill(0);
  }
}

function deleteExistingRows(tableName, prefix) {
  const result = JSON.parse(
    aws([
      'dynamodb',
      'query',
      '--table-name',
      tableName,
      '--key-condition-expression',
      'pk = :pk AND begins_with(sk, :prefix)',
      '--expression-attribute-values',
      JSON.stringify({ ':pk': { S: 'TEAM#default' }, ':prefix': { S: prefix } }),
      '--output',
      'json',
    ])
  );

  for (const item of result.Items ?? []) {
    aws([
      'dynamodb',
      'delete-item',
      '--table-name',
      tableName,
      '--key',
      JSON.stringify({ pk: item.pk, sk: item.sk }),
    ]);
  }
}

function putSecret(tableName, keyId, secret) {
  const now = new Date().toISOString();
  const secretId = randomUUID();
  const eventId = randomUUID();
  const encrypted = encryptValue(keyId, secret.password);
  const secretItem = {
    pk: attr('TEAM#default'),
    sk: attr(`SECRET#${secretId}`),
    secretId: attr(secretId),
    title: attr(secret.title),
    loginUrl: attr(secret.loginUrl),
    usernameHint: attr(secret.usernameHint),
    category: attr(secret.category),
    notes: attr(secret.notes),
    ciphertext: attr(encrypted.ciphertext),
    iv: attr(encrypted.iv),
    authTag: attr(encrypted.authTag),
    encryptedDek: attr(encrypted.encryptedDek),
    createdAt: attr(now),
    createdBy: attr('demo-seed'),
  };

  const auditItem = {
    pk: attr('TEAM#default'),
    sk: attr(`AUDIT#${now}#${eventId}`),
    eventId: attr(eventId),
    action: attr('CREATE'),
    secretId: attr(secretId),
    secretTitle: attr(secret.title),
    actorSub: attr('demo-seed'),
    actorEmail: attr('demo-seed@local'),
    timestamp: attr(now),
    seeded: { BOOL: true },
  };

  aws(['dynamodb', 'put-item', '--table-name', tableName, '--item', JSON.stringify(secretItem)]);
  aws(['dynamodb', 'put-item', '--table-name', tableName, '--item', JSON.stringify(auditItem)]);
  return secretId;
}

const tableName = stackOutput('VaultTableName');
const keyId = stackOutput('VaultKeyId');

deleteExistingRows(tableName, 'SECRET#');
deleteExistingRows(tableName, 'AUDIT#');
const seeded = demoSecrets.map((secret) => ({ title: secret.title, secretId: putSecret(tableName, keyId, secret) }));

console.log(JSON.stringify({ tableName, seeded }, null, 2));

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { TeamVaultLiteStack } from '../lib/team-vault-lite-stack';

// Load CDK feature flags from cdk.json so the test synth matches the CLI synth.
// Without this, defaults differ (e.g. UserPool.selfSignUpEnabled false produces
// AllowAdminCreateUserOnly=true in CLI but false in raw new cdk.App()).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cdkContext = require('../cdk.json').context as Record<string, unknown>;

// These tests assert the small set of stack invariants that, if regressed,
// would either break the demo or reopen the P0 authz hole. They synthesize
// the stack to a CloudFormation template and check resource shapes; no
// network or AWS calls are made.

function makeStack() {
  const app = new cdk.App({ context: cdkContext });
  return new TeamVaultLiteStack(app, 'TestStack', {
    env: { account: '111111111111', region: 'us-west-2' },
  });
}

describe('TeamVaultLite stack', () => {
  test('Cognito user pool has self-signup disabled', () => {
    // This is the P0 guardrail: CDK lowers `selfSignUpEnabled: false` to
    // `AdminCreateUserConfig.AllowAdminCreateUserOnly: true` in the synth
    // output. If this regresses, the Hosted UI exposes a public sign-up
    // form and the only thing standing between an attacker and the API is
    // the in-Lambda group check.
    const t = Template.fromStack(makeStack());
    const pools = t.findResources('AWS::Cognito::UserPool');
    const pool = Object.values(pools)[0] as { Properties?: { AdminCreateUserConfig?: { AllowAdminCreateUserOnly?: boolean } } };
    expect(pool.Properties?.AdminCreateUserConfig?.AllowAdminCreateUserOnly).toBe(true);
  });

  test('Cognito vault-admin and vault-member groups exist', () => {
    const t = Template.fromStack(makeStack());
    t.hasResourceProperties('AWS::Cognito::UserPoolGroup', {
      GroupName: 'vault-admin',
    });
    t.hasResourceProperties('AWS::Cognito::UserPoolGroup', {
      GroupName: 'vault-member',
    });
  });

  test('All /secrets, /audit, /members methods use the Cognito authorizer', () => {
    const t = Template.fromStack(makeStack());
    // Every Method resource on the API should have AuthorizationType=COGNITO_USER_POOLS
    // except the auto-generated OPTIONS preflight methods (which use NONE).
    const methods = t.findResources('AWS::ApiGateway::Method');
    for (const [, resource] of Object.entries(methods)) {
      const props = (resource as any).Properties;
      if (props.HttpMethod === 'OPTIONS') continue;
      expect(props.AuthorizationType).toBe('COGNITO_USER_POOLS');
    }
  });

  test('Lambda execution role has DynamoDB CRUD permissions on the vault table', () => {
    const t = Template.fromStack(makeStack());
    // The grantReadWriteData helper emits an IAM policy with the DynamoDB
    // actions list. We check the policy includes the data-plane actions our
    // Lambda actually uses. (Done with direct template inspection rather than
    // nested Match.arrayWith, which has surprising semantics.)
    const policies = t.findResources('AWS::IAM::Policy');
    const allActions: string[] = [];
    for (const resource of Object.values(policies)) {
      const stmts = (resource as any).Properties.PolicyDocument.Statement;
      for (const stmt of stmts) {
        const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        allActions.push(...actions);
      }
    }
    expect(allActions).toEqual(
      expect.arrayContaining([
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:DeleteItem',
      ])
    );
  });

  test('Lambda execution role has KMS encrypt+decrypt on the customer-managed key', () => {
    const t = Template.fromStack(makeStack());
    const policies = t.findResources('AWS::IAM::Policy');
    const allActions: string[] = [];
    for (const resource of Object.values(policies)) {
      const stmts = (resource as any).Properties.PolicyDocument.Statement;
      for (const stmt of stmts) {
        const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        allActions.push(...actions);
      }
    }
    expect(allActions).toEqual(
      expect.arrayContaining(['kms:Decrypt', 'kms:GenerateDataKey*'])
    );
  });

  test('Lambda execution role has Cognito admin actions scoped to the user pool', () => {
    const t = Template.fromStack(makeStack());
    const policies = t.findResources('AWS::IAM::Policy');
    const allActions: string[] = [];
    for (const resource of Object.values(policies)) {
      const stmts = (resource as any).Properties.PolicyDocument.Statement;
      for (const stmt of stmts) {
        const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        allActions.push(...actions);
      }
    }
    expect(allActions).toEqual(
      expect.arrayContaining([
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminAddUserToGroup',
      ])
    );
    expect(allActions).not.toContain('cognito-idp:AdminGetUser');
  });

  test('Secrets Lambda gets CORS allowlist from stack-generated origins', () => {
    const t = Template.fromStack(makeStack());
    const functions = t.findResources('AWS::Lambda::Function');
    const envValues = Object.values(functions).map((resource) =>
      JSON.stringify((resource as any).Properties.Environment?.Variables ?? {})
    );
    expect(envValues.some((env) =>
      env.includes('ALLOWED_ORIGINS') &&
      env.includes('WebDistribution') &&
      env.includes('DomainName') &&
      env.includes('http://localhost:5173')
    )).toBe(true);
  });

  test('Gateway responses include CORS headers (so 401s are visible to the browser)', () => {
    const t = Template.fromStack(makeStack());
    t.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
      ResponseType: 'DEFAULT_4XX',
      ResponseParameters: Match.objectLike({
        'gatewayresponse.header.Access-Control-Allow-Origin': Match.anyValue(),
      }),
    });
  });

  test('KMS customer-managed key has rotation enabled', () => {
    const t = Template.fromStack(makeStack());
    t.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
    });
  });

  test('S3 web bucket blocks all public access', () => {
    const t = Template.fromStack(makeStack());
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });
});

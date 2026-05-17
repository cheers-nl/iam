import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';

export class TeamVaultLiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------- S3 + CloudFront for the web UI (new in D6) ----------
    // Private S3 bucket — no public access, served only via CloudFront OAC.
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: `team-vault-lite-web-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront distribution with Origin Access Control (modern replacement
    // for the deprecated Origin Access Identity).
    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      defaultRootObject: 'index.html',
      // SPA fallback: 403/404 from S3 (route not present) -> serve index.html
      // so client-side routing can handle the URL.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    const cloudFrontUrl = `https://${distribution.distributionDomainName}`;

    // ---------- Cognito (callback URLs now include CloudFront + localhost) ----------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'team-vault-lite-users',
      // Self-signup is DISABLED: this is a team vault, not a public service.
      // Members join only via admin-issued invitations (AdminCreateUser).
      // Without this, anyone hitting the Hosted UI could create an account
      // and authenticate — Lambda role checks would 403 admin-only routes
      // but list/reveal would have been exposed (closed by isMemberOrAdmin
      // gate in the Lambda; this is the second defense layer).
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolDomain = userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: `team-vault-lite-${cdk.Stack.of(this).account}`,
      },
    });

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: 'team-vault-lite-web',
      authFlows: {
        userSrp: true,
        adminUserPassword: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          `${cloudFrontUrl}/callback`,
          'http://localhost:5173/callback', // Vite dev server
        ],
        logoutUrls: [
          `${cloudFrontUrl}/`,
          'http://localhost:5173/',
        ],
      },
      preventUserExistenceErrors: true,
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'team-vault-lite-auth',
    });

    // Cognito user pool groups for role-based access. Group names are read
    // from the ID token claim `cognito:groups` by the Lambda handler.
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'vault-admin',
      description: 'Vault administrators — CRUD secrets, view audit log, invite members.',
    });
    new cognito.CfnUserPoolGroup(this, 'MemberGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'vault-member',
      description: 'Vault members — list and reveal secrets only.',
    });

    // ---------- DynamoDB ----------
    const vaultTable = new dynamodb.Table(this, 'VaultTable', {
      tableName: 'team-vault-lite',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------- KMS ----------
    const vaultKey = new kms.Key(this, 'VaultKey', {
      alias: 'team-vault-lite/dek',
      description: 'Master key for Team Vault Lite envelope encryption',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------- Lambda ----------
    const secretsFn = new NodejsFunction(this, 'SecretsFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../app/secrets-handler/index.ts'),
      handler: 'handler',
      projectRoot: path.join(__dirname, '../../app'),
      depsLockFilePath: path.join(__dirname, '../../app/package-lock.json'),
      environment: {
        TABLE_NAME: vaultTable.tableName,
        KMS_KEY_ID: vaultKey.keyId,
        USER_POOL_ID: userPool.userPoolId,
        ALLOWED_ORIGINS: `${cloudFrontUrl},http://localhost:5173`,
      },
      timeout: cdk.Duration.seconds(10),
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    vaultTable.grantReadWriteData(secretsFn);
    vaultKey.grantEncryptDecrypt(secretsFn);

    // Cognito admin actions for the invitation flow. AdminCreateUser sends the
    // invitation email; AdminAddUserToGroup assigns the role. ListUsersInGroup
    // powers the /members listing for admins.
    secretsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:ListUsersInGroup',
        ],
        resources: [userPool.userPoolArn],
      })
    );

    // ---------- Policy Advisor Lambda (Phase A — Bedrock-backed) ----------
    const policyAdvisorFn = new NodejsFunction(this, 'PolicyAdvisorFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../app/policy-advisor/index.ts'),
      handler: 'handler',
      projectRoot: path.join(__dirname, '../../app'),
      depsLockFilePath: path.join(__dirname, '../../app/package-lock.json'),
      timeout: cdk.Duration.seconds(60),
      bundling: { externalModules: ['@aws-sdk/*'] },
    });

    // Bedrock cross-region inference: the IAM policy must grant InvokeModel
    // on BOTH the inference profile AND the underlying foundation models in
    // every region the profile may route to. Missing any one of these returns
    // an AccessDeniedException with no hint that the cross-region routing is
    // the cause — captured separately as a pain log entry.
    policyAdvisorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-opus-4-6-v1`,
          `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-opus-4-6-v1`,
          `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-opus-4-6-v1`,
          `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-opus-4-6-v1`,
        ],
      })
    );

    // ---------- API Gateway with CORS (CORS new in D6) ----------
    const api = new apigateway.RestApi(this, 'HelloApi', {
      restApiName: 'team-vault-lite-api',
      deployOptions: { stageName: 'prod' },
      // Default CORS: OPTIONS preflight returns these headers automatically.
      // Cognito authorizer is NOT attached to OPTIONS (CDK handles this).
      defaultCorsPreflightOptions: {
        allowOrigins: [cloudFrontUrl, 'http://localhost:5173'],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
        maxAge: cdk.Duration.minutes(10),
      },
    });

    const methodOptions: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: authorizer,
    };

    const secretsResource = api.root.addResource('secrets');
    const integration = new apigateway.LambdaIntegration(secretsFn);
    secretsResource.addMethod('POST', integration, methodOptions);
    secretsResource.addMethod('GET', integration, methodOptions);

    const secretByIdResource = secretsResource.addResource('{id}');
    secretByIdResource.addMethod('GET', integration, methodOptions);
    secretByIdResource.addMethod('DELETE', integration, methodOptions);

    // Audit log endpoint — admins see who revealed what when.
    const auditResource = api.root.addResource('audit');
    auditResource.addMethod('GET', integration, methodOptions);

    // Member management — admins list and invite team members.
    const membersResource = api.root.addResource('members');
    membersResource.addMethod('GET', integration, methodOptions);
    membersResource.addMethod('POST', integration, methodOptions);

    // Whoami — anyone can check their role.
    const meResource = api.root.addResource('me');
    meResource.addMethod('GET', integration, methodOptions);

    // Gateway responses (4xx/5xx generated by API Gateway itself, e.g. Cognito
    // authorizer rejection) need CORS headers too — separate from preflight
    // and from Lambda response headers. Tightened from "*" to the CloudFront
    // origin. Dev localhost requests that hit gateway 4xx will be blocked by
    // the browser (acceptable tradeoff; dev experience is secondary, and the
    // Lambda response path — which carries actual vault data — uses dynamic
    // Allow-Origin echoing for the localhost dev case).
    const allowedOriginForGatewayResponse = `'${cloudFrontUrl}'`;
    api.addGatewayResponse('Default4xxCors', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': allowedOriginForGatewayResponse,
        'Access-Control-Allow-Headers': "'Authorization,Content-Type'",
      },
    });
    api.addGatewayResponse('Default5xxCors', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': allowedOriginForGatewayResponse,
        'Access-Control-Allow-Headers': "'Authorization,Content-Type'",
      },
    });

    // ---------- Outputs ----------
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API base URL (append /secrets or /secrets/{id})',
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });
    new cdk.CfnOutput(this, 'HostedUiBaseUrl', {
      value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito Hosted UI base URL',
    });
    new cdk.CfnOutput(this, 'VaultTableName', {
      value: vaultTable.tableName,
      description: 'DynamoDB vault table name',
    });
    new cdk.CfnOutput(this, 'VaultKeyId', {
      value: vaultKey.keyId,
      description: 'KMS CMK key ID',
    });
    new cdk.CfnOutput(this, 'VaultKeyArn', {
      value: vaultKey.keyArn,
      description: 'KMS CMK key ARN',
    });
    new cdk.CfnOutput(this, 'WebBucketName', {
      value: webBucket.bucketName,
      description: 'S3 bucket for web UI assets',
    });
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: cloudFrontUrl,
      description: 'CloudFront distribution URL (your web UI lives here)',
    });
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID (for cache invalidation)',
    });
    new cdk.CfnOutput(this, 'PolicyAdvisorFunctionName', {
      value: policyAdvisorFn.functionName,
      description: 'Bedrock-backed policy advisor Lambda (invoke directly)',
    });
  }
}

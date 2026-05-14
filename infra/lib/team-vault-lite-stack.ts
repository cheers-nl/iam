import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class TeamVaultLiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------- Cognito (unchanged from D3) ----------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'team-vault-lite-users',
      selfSignUpEnabled: true,
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
        callbackUrls: ['https://example.com/callback'],
        logoutUrls: ['https://example.com/'],
      },
      preventUserExistenceErrors: true,
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'team-vault-lite-auth',
    });

    // ---------- DynamoDB (new in D4) ----------
    const vaultTable = new dynamodb.Table(this, 'VaultTable', {
      tableName: 'team-vault-lite',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------- Lambda (was HelloFunction, now SecretsFunction) ----------
    const secretsFn = new NodejsFunction(this, 'SecretsFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../app/secrets-handler/index.ts'),
      handler: 'handler',
      projectRoot: path.join(__dirname, '../../app'),
      depsLockFilePath: path.join(__dirname, '../../app/package-lock.json'),
      environment: {
        TABLE_NAME: vaultTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    });

    // D4 grants broad read/write on the entire table. D4 stretch will attempt
    // to narrow this with condition keys (and document the friction).
    vaultTable.grantReadWriteData(secretsFn);

    // ---------- API Gateway routes (was /hello, now /secrets + /secrets/{id}) ----------
    const api = new apigateway.RestApi(this, 'HelloApi', {
      restApiName: 'team-vault-lite-api',
      deployOptions: {
        stageName: 'prod',
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
  }
}

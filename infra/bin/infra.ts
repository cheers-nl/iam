#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { TeamVaultLiteStack } from '../lib/team-vault-lite-stack';

const app = new cdk.App();
new TeamVaultLiteStack(app, 'TeamVaultLite', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

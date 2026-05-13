# Team Vault Lite

A small AWS-native team password vault — a learning project exploring KMS envelope encryption, Cognito authentication, and IAM patterns for per-user data isolation.

## Status

In development. See [docs/plan.md](docs/plan.md) for the implementation roadmap.

## Stack

- **Infrastructure:** AWS CDK (TypeScript)
- **Compute:** AWS Lambda + API Gateway
- **Auth:** Amazon Cognito user pool + Hosted UI
- **Storage:** Amazon DynamoDB
- **Encryption:** AWS KMS customer-managed key (envelope encryption)
- **Frontend:** React + Vite on Amazon S3 + Amazon CloudFront
- **CI/CD:** GitHub Actions via AWS OIDC federation

## Documents

- [Implementation plan](docs/plan.md)
- [Pain log](pain-log.md) — IAM friction encountered during the build

# Team Vault

A small AWS-native team password vault — a learning project exploring KMS envelope encryption, Cognito-based authentication, role-based authorization, and IAM patterns for credential management in a shared team context.

## Status

In development as the build artifact for a Day 1 onboarding deliverable. See [docs/deliverable-6pager.md](docs/deliverable-6pager.md) for the full report, [docs/plan.md](docs/plan.md) for the implementation roadmap, and [pain-log.md](pain-log.md) for the IAM friction observations captured during the build.

## What it is

A single-tenant shared team vault. Admins (`vault-admin` Cognito group) create, delete, and reveal secrets, view the activity log, and invite teammates. Members (`vault-member` group) can list and reveal secrets but cannot create, delete, or invite. Self-signup is disabled; membership is invite-only via `AdminCreateUser` + `AdminAddUserToGroup`. Every secret is encrypted at rest with envelope encryption (KMS-issued data key, AES-256-GCM in Lambda, encrypted data key stored alongside ciphertext in DynamoDB). Every `CREATE` / `REVEAL` / `DELETE` / `INVITE` is logged to a DynamoDB audit table; underneath, every KMS call is also captured automatically by CloudTrail.

## Stack

- **Infrastructure:** AWS CDK (TypeScript)
- **Compute:** AWS Lambda + Amazon API Gateway (REST with Cognito User Pool authorizer)
- **Auth:** Amazon Cognito user pool + Hosted UI; role gating via `cognito:groups`
- **Storage:** Amazon DynamoDB (single-table design)
- **Encryption:** AWS KMS customer-managed key (envelope encryption)
- **Frontend:** React + Vite, hosted on Amazon S3 + Amazon CloudFront (Origin Access Control)
- **Policy review experiment:** Bedrock-backed Lambda (Claude Opus 4.6 via `us.anthropic.claude-opus-4-6-v1` inference profile)
- **Deploys:** `cdk deploy` from local AWS SSO credentials for infrastructure; `aws s3 sync` + `aws cloudfront create-invalidation` for the SPA bundle. No CI/CD workflow is configured yet.

## Repository layout

```
infra/        CDK app (single stack: TeamVaultLite)
app/          Lambda handler sources
  secrets-handler/   The vault API (Lambda Function)
  policy-advisor/    The AI policy advisor experiment (Lambda Function)
frontend/     Vite + React SPA
docs/         Deliverable, planning, evidence appendix
pain-log.md   Friction observations captured during the build (32 entries)
```

## Documents

- [docs/deliverable-6pager.md](docs/deliverable-6pager.md) — Day 1 report (the deliverable)
- [docs/plan.md](docs/plan.md) — Implementation plan + decisions log
- [docs/ai-vs-aa-comparison.md](docs/ai-vs-aa-comparison.md) — AI advisor vs IAM Access Analyzer findings
- [docs/evidence/](docs/evidence/) — Test policy fixtures + raw outputs from both tools
- [pain-log.md](pain-log.md) — IAM friction encountered during the build

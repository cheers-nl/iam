# AWS IAM — pre-employment learning journey

Work I've done while preparing to join the AWS IAM team as PMT-ES. Two hands-on learning exercises, each surfacing IAM friction observations from real customer-shaped scenarios.

## Exercises

### `team-vault/` — Day 1 Build Report (complete)

An 8-day rebuild of a real team-credential-sharing problem on AWS-native primitives. Surfaced 29 IAM friction observations and 4 product opportunities, distilled into a Top 10 friction table with product suggestions.

Built on Cognito (Hosted UI + PKCE), CloudFront/S3 SPA, API Gateway with Cognito authorizer, Lambda, DynamoDB, KMS envelope encryption, CloudTrail audit, and IAM Access Analyzer.

- Deliverable: [`team-vault/docs/Team Vault Build Report.docx`](team-vault/docs/Team%20Vault%20Build%20Report.docx)
- Markdown source: [`team-vault/docs/deliverable-6pager.md`](team-vault/docs/deliverable-6pager.md)
- Pain log: [`team-vault/pain-log.md`](team-vault/pain-log.md)
- Live demo: https://d27nvg04sp0g9m.cloudfront.net (available through 2026-05-25)
- Repository overview: [`team-vault/README.md`](team-vault/README.md)

### `federation/` — Identity federation exercise (planned)

Setting up identity federation from Okta or Microsoft Entra ID to AWS, with the goal of understanding what enterprise customers experience configuring SSO into the AWS console. Scope pending confirmation from Kai.

Status: not started.

## Repository layout

```
iam/
├── README.md              this file
├── team-vault/            Day 1 Build Report (Team Vault)
│   ├── app/               Lambda handler sources
│   ├── frontend/          Vite + React SPA
│   ├── infra/             AWS CDK stack (TypeScript)
│   ├── scripts/           Demo smoke test, audit trail helper, demo-data seeder
│   ├── docs/              Deliverable, evidence, screenshots, prep notes
│   ├── pain-log.md        32 friction observations captured during the build
│   └── README.md          Team Vault repo overview
└── federation/            (will be added when scope is confirmed)
```

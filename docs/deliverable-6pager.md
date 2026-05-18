# AWS IAM: Day 1 Build Report

*Hands-on IAM friction from building a real AWS-hosted internal team vault, plus an empirical test of AI-assisted policy review.*

## Executive Summary

I built **Team Vault**, a single-tenant internal credential manager for a small B2B SaaS team that already runs on AWS and has a customer or compliance reason to keep sensitive operational credentials in its own account. The app is intentionally a normal customer build, not an identity-only exercise: a React SPA on S3 + CloudFront, Cognito Hosted UI auth, API Gateway with a Cognito authorizer, Lambda handlers, DynamoDB storage and audit, KMS envelope encryption, CDK infrastructure, and a Bedrock-backed policy advisor.

Across 8 days of building, I logged **32 IAM-adjacent friction moments**. The pattern was consistent: the hardest parts were not missing features, but hidden state, hidden defaults, split responsibility across services, and errors that do not name the failing layer. The highest-impact finding: IAM Access Analyzer has a specialized `check-no-public-access` API that catches a public-principal trust policy (`Principal: "*"`), but the synchronous `validate-policy` path did not route me there even with the trust-policy resource-type hint. A small Bedrock-backed advisor caught the public-principal issue at the same "pre-deploy review" moment and also surfaced 3 other semantic patterns from the same fixture set, at about **$0.06 per review**.

- Live demo: <https://d27nvg04sp0g9m.cloudfront.net>
- Code: <https://github.com/cheers-nl/iam>
- Full pain log: [`pain-log.md`](../pain-log.md)
- Reproducible AI-vs-AA evidence: [`docs/evidence`](evidence/README.md)

## What I Built

**Customer scenario.** A 12-person B2B SaaS team in a compliance-adjacent vertical manages 40+ third-party credentials: Stripe, SendGrid, Datadog, OpenAI, customer-specific tokens, and CI/CD signing keys. Most teams should buy 1Password Business; this build inhabits the smaller segment with contract, sovereignty, or audit requirements that push them to build inside their own AWS account.

**Product.** Team Vault lets admins create, reveal, delete, audit, and invite members. Members can list and reveal secrets. Self-signup is disabled; membership is invite-only through Cognito admin APIs. Each secret uses KMS envelope encryption: Lambda calls `GenerateDataKey`, encrypts locally with AES-256-GCM, stores ciphertext plus encrypted data key in DynamoDB, and calls `Decrypt` only during reveal. The app also writes application-level audit events for `CREATE`, `REVEAL`, `DELETE`, and `INVITE`; KMS key use is separately captured by CloudTrail.

**Architecture.** Cognito Hosted UI -> CloudFront/S3 React SPA -> API Gateway REST API with Cognito authorizer -> Lambda -> DynamoDB + KMS. CDK provisions backend and edge infrastructure. The frontend bundle is built locally and uploaded to S3 with a CloudFront invalidation. A separate Lambda invokes Claude Opus 4.6 on Bedrock for policy review experiments.

**Build path.**

1. Set up account guardrails, root MFA, IAM Identity Center, admin access, and AWS SSO CLI.
2. Bootstrap CDK and deploy the first Lambda/API Gateway path.
3. Add Cognito Hosted UI authentication and API Gateway authorizer.
4. Add DynamoDB storage and app-level scoping.
5. Add KMS envelope encryption.
6. Add S3 + CloudFront web hosting and solve CORS across preflight, Lambda responses, and gateway responses.
7. Refactor to team roles, Cognito groups, audit log, and invite flow.
8. Run IAM Access Analyzer `validate-policy`, build a Bedrock advisor, and compare both tools on the same policies.

The customer problem is grounded in prior product experience with small-business teams sharing operational credentials. That prior non-AWS implementation used Postgres, a self-managed AES-256-GCM key in an environment variable, and custom audit logging; rebuilding the same customer problem on AWS primitives made the IAM tradeoffs easier to see.

## Stack-Ranked IAM Friction

| Rank | Observation | Why it matters | Product suggestion |
|---:|---|---|---|
| 1 | `validate-policy` did not route a `Principal: "*"` trust policy to `check-no-public-access`. | AWS has the detection capability, but it lives in a separate command/API; the newcomer path gives a clean result at the exact pre-deploy moment when a warning would help. | In `validate-policy`, either fan out to the specialized public-access check when the resource type is known, or return a next-step hint that names `check-no-public-access` / external-access analysis. |
| 2 | KMS access is a hidden two-policy contract. | Docs say key policy and identity policy both matter, but the default root statement silently enables IAM delegation; removing it breaks otherwise valid IAM grants. | In the KMS console/CDK output, label the root statement as "enables IAM policy delegation" instead of looking like accidental over-permission. |
| 3 | API Gateway CORS has three independent surfaces. | Preflight, Lambda responses, and gateway-generated 401/403s each need headers; all failures collapse into browser "Failed to fetch." | Offer one higher-level CORS contract for Cognito-protected APIs, or error messages that name the missing surface. |
| 4 | DynamoDB `LeadingKeys` is structurally hard to use behind Lambda. | The common browser -> API Gateway -> Lambda pattern has one execution role, so per-user IAM row scoping requires STS session tags and role assumption. | Provide a first-class Lambda + DynamoDB scoped-access pattern in CDK or serverless docs. |
| 5 | `cdk bootstrap` creates significant IAM surface with little explanation. | New accounts receive 5 roles plus supporting resources before the user understands the trust and pass-role chain. | Print a purpose table before creation and a `cdk bootstrap --show-resources` inspection command after. |
| 6 | CDK's default `cfn-exec-role` has `AdministratorAccess`. | The actual deploy path is user -> deploy role -> CloudFormation -> admin execution role, but the chain is not taught at the consent moment. | Explain the chain in bootstrap/deploy output and provide a guided least-privilege bootstrap path. |
| 7 | CDK's IAM change prompt asks for consent users cannot evaluate. | The prompt lists statements uniformly, so routine plumbing and broad grants look equally opaque. | Add plain-language annotations and a blast-radius summary before the `y/n` prompt. |
| 8 | IAM Identity Center home region is permanent. | The setup screen does not make permanence obvious; the new multi-region feature can be misread as making the initial region choice flexible. | Put the permanence warning on the enablement screen and distinguish replication from home-region mutability. |
| 9 | Bedrock model access has multiple gates with different errors. | Region routing, model enablement, Anthropic use-case form, and sales-tier restrictions look like unrelated IAM denials. | Return an error that names the exact gate and links to the required UI/action. |
| 10 | API Gateway Cognito authorizer accepts ID tokens, not access tokens. | This reverses OAuth intuition, and wrong-token vs expired-token failures both return generic 401s. | Differentiate wrong token type, expired token, and malformed token in authorizer responses. |

## AI Policy Advisor Experiment

I tested whether an LLM could catch IAM issues that static validation misses or routes to a separate tool. I ran 6 policy fixtures through IAM Access Analyzer `validate-policy`, one applicable specialized AA check, and a Bedrock-backed Lambda using Claude Opus 4.6.

| Policy | AA result | AI findings | Net result |
|---|---:|---:|---|
| Real Lambda execution policy | 0 | 3 | AI flagged overprovisioning/hygiene patterns. |
| Full admin `*:*` on `*` | 2 | 4 | AI caught AA's concern plus broader privilege-escalation context. |
| Public trust policy `Principal: "*"` | `validate-policy`: 0; `check-no-public-access`: FAIL | 3 | AA has the capability, but not in the first tool path; AI caught it in-line. |
| `s3:GetObject` on IAM role ARN | 0 | 2 | AI caught action/resource semantic mismatch. |
| `kms:*` on `*` | 0 | 5 | AI caught service-specific KMS escalation paths. |
| Prompt-injection Sid + full admin | 2 | 4 | AI still flagged the dangerous policy and called out the suspicious Sid. |

This is not a replacement story. Access Analyzer is deterministic, fast, free, and strong at structural validation, known dangerous patterns such as `iam:PassRole` wildcards, and specialized checks like public-access detection. The product gap I observed is tool-surface integration: users have to know which AA capability answers which question. The AI advisor is useful as a second pass for semantic review: slower, non-deterministic, and not security-blessed, but able to explain why a pattern matters in language a newcomer can act on. The raw inputs and outputs are in [`docs/evidence`](evidence/README.md).

## Product Opportunities

1. **Surface what AWS creates on the user's behalf.** Bootstrap, KMS defaults, and IdC setup should show newly-created IAM surface with purpose labels.
2. **Make consent prompts actionable.** `cdk deploy` should distinguish normal service plumbing from broad or privilege-escalating grants.
3. **Co-locate configuration for cross-service features.** CORS, Cognito authorizers, and per-row DynamoDB scoping should have higher-level guided patterns.
4. **Make errors name the failed layer.** Wrong token type, missing gateway CORS, Bedrock model gate, and KMS policy-side failures should be explicit.
5. **Productize semantic policy review.** Add an optional `--deep-review` mode or CDK synth hook that runs an LLM-backed review after static validation, with budget/rate guardrails.

## Bright Spots

Unused Access Analyzer produced findings within 55 seconds and independently surfaced the CDK execution-role overprovisioning concern. Origin Access Control is a clean modernization over OAI, and CDK's `S3BucketOrigin.withOriginAccessControl` made it almost invisible. CDK grant helpers prevented many hand-written policy mistakes even when they over-granted. Those bright spots matter: the strongest product path is not "IAM lacks capability," but "IAM has the pieces; the customer has to assemble and interpret too much of the system themselves."

## Appendix

- **Demo**: <https://d27nvg04sp0g9m.cloudfront.net>
- **Code**: <https://github.com/cheers-nl/iam>
- **Full pain log**: [`pain-log.md`](../pain-log.md)
- **AI-vs-AA evidence**: [`docs/evidence`](evidence/README.md)
- **AI advisor implementation**: [`app/policy-advisor/index.ts`](../app/policy-advisor/index.ts)
- **CDK stack**: [`infra/lib/team-vault-lite-stack.ts`](../infra/lib/team-vault-lite-stack.ts)

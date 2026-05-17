# AWS IAM: A Newcomer's Build Report

*An 8-day hands-on evaluation of AWS IAM, framed as the engineering experience of building a real internal team tool — with an empirical test of AI-assisted policy review.*

---

## Executive Summary

AWS IAM friction for newcomers is rarely about missing capabilities. It is about **hidden state, hidden defaults, and silent failures**. Across 8 days of building Team Vault — an internal AWS-native credential manager that a small SaaS engineering team might build themselves rather than buy a third-party password manager — I logged 32 friction moments. To test the implication that AI-assisted policy review could surface what AWS's static analyzer misses, I built a Bedrock-backed advisor (Claude Opus 4.6) and ran it head-to-head with IAM Access Analyzer's `validate-policy` on the same 5 test policies; the advisor caught 4 patterns Access Analyzer missed — including a high-risk `Principal: "*"` trust-policy case — at a total cost of $0.30. This document presents the top 10 of those 32 observations as a stack-ranked list, anchors a section on the AI experiment, and proposes 5 product directions tied to the team's current simplification mandate. The full pain log is in the appendix.

---

## The customer

A 12-person B2B SaaS team in a compliance-adjacent vertical — fintech tooling, healthcare scheduling, or an industry marketplace. They already run on AWS. Their engineers manage 40+ third-party credentials: Stripe master, SendGrid, Datadog, OpenAI, customer-specific tokens, CI/CD signing keys. Their largest customer contract bars storing payment-flow credentials in third-party SaaS. They have been doing the worst possible thing — sharing these in 1Password's free tier and Slack DMs. An engineer spends a sprint building an internal team vault — encrypted with their own KMS key (every key use automatically logged to CloudTrail), application-level reveal-and-mutate audit in a dedicated DynamoDB table, IAM-scoped through Cognito — on the AWS infrastructure they already operate. Roughly 95% of teams should still buy 1Password Business; this document inhabits the 5% with a contract clause or sovereignty constraint who reach for AWS instead.

---

## What I built

**Team Vault** is a single-tenant team password manager that lives entirely in the customer's AWS account. It spans Cognito (Hosted UI authentication), API Gateway (REST with a Cognito authorizer), Lambda (Node.js handlers on the AWS SDK v3), DynamoDB (single-table storage for both vault entries and audit events), KMS (customer-managed key with envelope encryption via AES-256-GCM), and S3 + CloudFront with Origin Access Control (the React SPA). Roles are enforced through Cognito user pool groups — `vault-admin` and `vault-member` — with self-signup disabled; membership is invite-only via the Lambda's `AdminCreateUser` + `AdminAddUserToGroup` flow. A separate Bedrock-backed Lambda implements the AI policy advisor. The backend and edge infrastructure are provisioned through AWS CDK; the frontend bundle is built locally with Vite and uploaded to S3 with a CloudFront invalidation. The live demo runs at `d27nvg04sp0g9m.cloudfront.net`; the code is at `github.com/cheers-nl/iam`. The customer scenario above is grounded in prior hands-on experience with a similar credential-sharing feature in a small-business SaaS product (referenced in Appendix C).

The customer problem is grounded in prior product experience, not invented for an IAM exercise. I previously worked on **Stellen** ([stellenapp.com](https://stellenapp.com/)), a small-business team platform where organizational accounts needed to share internal credentials across their team. That product used Postgres and a self-managed AES-256-GCM key held in an environment variable, with custom application-level access logging. Team Vault re-evaluates the same customer problem on AWS-native primitives — KMS-managed envelope encryption, DynamoDB-backed audit, Cognito groups, and CloudTrail-captured KMS use — which made the IAM friction easier to compare against a non-AWS baseline.

---

## The 8-step build

Each step is roughly a day's work for the engineer experiencing it.

1. **Open and harden the AWS account.** Enroll root MFA, configure a zero-spend budget alarm, enable IAM Identity Center, pick a home region (which is permanent), create an admin user, and configure `aws sso login` for the CLI.

2. **Initialize Infrastructure-as-Code.** Install AWS CDK, run `cdk bootstrap` once per region — silently creating 5 IAM roles in the account — and deploy a hello-world Lambda behind API Gateway.

3. **Add end-user authentication.** Stand up a Cognito user pool with email signup, enable the Hosted UI, attach a Cognito authorizer to API Gateway, and verify ID tokens propagate to Lambda as claims.

4. **Add scoped data storage.** Introduce DynamoDB with a single-table design. Wire Lambda to read and write secrets scoped first by user identity, later refactored to team identity.

5. **Add envelope encryption with KMS.** Create a customer-managed key with annual rotation. Switch Lambda to `GenerateDataKey` on write and `Decrypt` on read; encrypt locally with AES-256-GCM. Cleartext passwords now exist only in Lambda memory during a single request.

6. **Add the web UI.** Build a Vite + React SPA. Host on a private S3 bucket served through CloudFront with Origin Access Control. Wire OAuth to Cognito's Hosted UI. Configure CORS at three independent surfaces before the browser stops returning "Failed to fetch."

7. **Add audit, roles, and team invitation.** Refactor the vault from per-user to shared team. Create Cognito groups for roles. Gate sensitive endpoints on the `cognito:groups` claim. Add audit log, delete, and invitation endpoints, each admin-only.

8. **Run policy-review tooling.** Run IAM Access Analyzer's `validate-policy` against a small set of test policies. Then build a Bedrock-backed Lambda (Claude Opus 4.6) that takes a policy and returns structured findings, and compare on the same inputs.

What follows is what hit me along the way, stack-ranked by severity × frequency × strategic relevance to the IAM team. The full 32-entry log is in the appendix; this body contains the top 10.

---

## Top 10 friction observations

**1. IAM Access Analyzer's `validate-policy` does not flag `Principal: "*"` in trust policies — a high-impact public-principal mistake.** *(severity: high)* Even with the correct `--validate-policy-resource-type AWS::IAM::AssumeRolePolicyDocument` flag set, `validate-policy` returns zero findings on a trust policy that allows ANY AWS principal to assume the role with no `Condition`. AA appears to expect this to be caught by the asynchronous *external-access* analyzer, but `validate-policy` is positioned in tooling and docs as the synchronous pre-deploy check; a high-impact trust-policy mistake passes the most-reached-for tool.

**2. KMS "double grant" is conditional — the default key policy makes the requirement invisible.** *(severity: high)* AWS documentation describes KMS access as requiring both the key policy and the IAM identity policy to allow the action. In practice, the default key policy grants `kms:*` to the account root principal, which silently enables IAM delegation — identity policy alone suffices as long as the root statement is intact. A security-minded user who "tightens" the key policy by removing the root statement (it looks overly permissive) silently breaks every IAM-based grant on the key. The contract between the two policies is real, but the default makes the contract invisible.

**3. API Gateway CORS has three independent surfaces; each fails with the same browser-side "Failed to fetch."** *(severity: high)* OPTIONS preflight (CDK's `defaultCorsPreflightOptions`), the actual Lambda response (handled in Lambda code), and gateway responses for authorizer rejections (configured via `addGatewayResponse`) are three separate configuration points that each need CORS headers. The browser's `Failed to fetch` error gives no signal which surface is missing. Newcomers configure surface 1, hit a wall, fix surface 2, hit a wall again, and only discover surface 3 when their token expires and API Gateway returns a 401 from the authorizer with no CORS headers attached.

**4. DynamoDB `LeadingKeys` condition keys promise per-row IAM enforcement, but the dominant Lambda-backed pattern can't reach them.** *(severity: high)* `LeadingKeys` is designed for architectures where each user has their own AWS credentials (typically via Cognito Identity Pool issuing per-user STS credentials). The dominant browser → API Gateway → Lambda → DynamoDB pattern has one execution role for all users — to use `LeadingKeys`, Lambda must `sts:AssumeRole` with the user's `sub` as a session tag, replacing three lines of application-level scoping with a multi-step STS dance. In practice everyone defaults to application-level scoping. IAM's most powerful per-row mechanism is structurally inaccessible to AWS's most-documented serverless pattern.

**5. `cdk bootstrap` silently creates 5 IAM roles and 4 supporting resources, with no consent prompt or per-role explanation.** *(severity: medium-high)* The command provisions 5 IAM roles (`cfn-exec-role`, `deploy-role`, `file-publishing-role`, `image-publishing-role`, `lookup-role`), an S3 asset bucket, an ECR repository, and an SSM parameter — without asking what the user wants. The role names embed a meaningless qualifier hash (`hnb659fds`) and the console offers no per-role description. A newcomer who does not read the bootstrap output carefully has substantial IAM surface in their account without knowing.

**6. CDK's `cfn-exec-role` carries `AdministratorAccess` by default; the privilege chain via `iam:PassRole` is invisible.** *(severity: medium-high)* Every `cdk deploy` runs against the user's account with full admin permissions through a three-hop chain: user → deploy-role → CloudFormation service (via `iam:PassRole`) → cfn-exec-role → AWS resources. None of the hops is explained at bootstrap time. Most users never notice; security-conscious ones notice after the fact while browsing IAM. This is among the most-cited "AWS IAM is implicitly permissive" failure modes.

**7. `cdk deploy`'s IAM Statement Changes prompt requests consent that newcomers cannot meaningfully give.** *(severity: medium-high)* CDK shows a table of all IAM statements being added or modified and asks `y/n` before deploying. Entries are presented uniformly — there is no signal distinguishing standard plumbing (e.g., API Gateway granted `lambda:InvokeFunction`) from genuinely broader grants. A newcomer cannot evaluate the change, so the answer is always `y`. The prompt looks like a security checkpoint but functions as a security ritual.

**8. IAM Identity Center's home region is permanent, and the new multi-region announcement makes the trap easier to fall into.** *(severity: medium-high)* The home region chosen at first enable cannot be changed; relocating requires deleting the entire IdC instance (losing users, permission sets, and assignments) and recreating. The enablement screen does not surface this. February 2026's IdC multi-region replication feature reads naturally as "IdC now supports multiple regions" — a newcomer doing research can plausibly conclude that region choice is flexible and act carelessly. The silent permanence plus the ambiguous new-feature framing compound.

**9. Bedrock model access has four independent gating layers; each produces a different cryptic error.** *(severity: medium-high)* (1) Region availability — calling a foundation model directly returns "Invocation isn't supported with on-demand throughput, use an inference profile." (2) Account-level enablement — first invocation fails despite the "auto-enable on first invocation" claim that replaced the retired Model Access page. (3) The Anthropic use-case form — required for first-time Anthropic users, with the only documented entry point being the Playground UI. (4) A sales-tier gate on the newest top-tier models (Opus 4.7, Sonnet 4.6) — discoverable only by trying them and seeing `AccessDeniedException`. Each layer surfaces a different error in a different UI.

**10. Cognito User Pool Authorizer accepts ID tokens, rejects Access tokens — opposite of OAuth convention, with identical 401 messages.** *(severity: medium-high)* OAuth convention says access tokens are used to access APIs; ID tokens identify the user. AWS's API Gateway Cognito authorizer defaults to accepting only the ID token. Both tokens come from the same `admin-initiate-auth` response. The rejection on the access token is a generic `{"message":"Unauthorized"}` — identical to the response for a malformed or expired token. Expected debugging time on first encounter: hours.

---

### Empirical experiment: AI advisor vs IAM Access Analyzer

Finding #1 above predicts that AI semantic review could catch what AWS's static analyzer misses. To test, I built a Lambda backed by Claude Opus 4.6 on Amazon Bedrock that accepts a policy JSON and returns structured findings. I ran the advisor against the same 5 policies given to IAM Access Analyzer's `validate-policy`: a baseline real Lambda policy, a wildcard admin policy, a public `Principal: "*"` trust policy, an action/resource mismatch, and a `kms:*` wildcard.

On the headline test — the `Principal: "*"` trust policy — IAM Access Analyzer returned zero findings. Claude Opus 4.6 returned three findings, including a HIGH-severity "public-principal" flag explaining that any entity in any AWS account could assume the role. Across the full 5-policy set the AI advisor caught **4 patterns AA missed**, at a per-policy cost of **$0.06** (total $0.30 for the five reviews). The full per-policy comparison is in the appendix.

This is not a replacement story. AA's strengths remain — syntax validation, dangerous-pattern detection (e.g. `iam:PassRole` wildcards, service-linked-role creation risks), regex-fast feedback at organizational scale, and the separate unused-access analyzer that surfaces overprovisioning over time. The advisor complements rather than replaces: a "deep review" pass on policies that AA marks as clean, costing pennies, surfacing exactly the semantic patterns that static rules cannot enumerate. Productized, this addresses a substantial slice of recommendation #5 below.

---

## 5 product opportunities for the IAM team

These are the changes that would make the friction above stop being friction. Each is framed as the user's improved experience, the concrete mechanism, and a success criterion the team can hold itself to.

**1. Surface what AWS creates on the user's behalf.** A newcomer running `cdk bootstrap`, enabling IdC, or creating a KMS key learns exactly what IAM surface area they just added — and what each role or default statement does — in the same screen, without navigating to IAM separately. Bootstrap output includes a summary table of every IAM resource created with one-line purpose descriptions; the IdC enable screen warns that home region is permanent and that the new multi-region feature does not change this; the KMS console flags when the default root statement is what enables IAM access. *Success criterion: in newcomer cohorts, fewer than 10% of `aws iam list-roles` outputs surprise the developer who provisioned them.*

**2. Make consent prompts genuinely actionable, not theatrical.** A developer asked to approve IAM changes during `cdk deploy` sees not just raw policy statements but a plain-language summary distinguishing standard plumbing (e.g., API Gateway granted `lambda:InvokeFunction` on the Lambda it's wired to) from genuinely broader grants requiring review. The CLI annotates each line and produces a single-sentence blast-radius summary above the prompt. *Success criterion: a majority of developers who confirm the prompt can, after the fact, explain in their own words what they approved.*

**3. Co-locate the configuration surfaces of features that span multiple services.** A developer wiring CORS for a Cognito-protected API behind CloudFront configures it once. A developer who wants per-row DynamoDB authorization expresses it declaratively at the Lambda construct level instead of assembling a five-component STS-session-tag state machine. CDK ships first-class higher-level constructs — `enableCors`, `LambdaScopedDynamoDbHandler` — that wire the multi-surface plumbing transparently and document the underlying surfaces for those who must deviate. *Success criterion: time-to-first-successful-cross-origin-fetch from a CloudFront-hosted SPA to a Cognito-protected API drops from hours to a single deploy.*

**4. Make error messages name the layer that failed.** A 401 from API Gateway distinguishes "wrong token type" from "expired token" from "malformed token." A Bedrock `AccessDeniedException` names which of the four access gates blocked the call and links to the specific UI to resolve. A CORS-blocked fetch surfaces *which* of the three CORS surfaces is missing rather than the universal "Failed to fetch." *Success criterion: support ticket volume on "I'm getting 401" and "Failed to fetch" drops in first-90-day cohorts; mean time-to-resolution on access errors halves.*

**5. Productize an AI policy advisor as a complement to static analysis.** A developer running `aws accessanalyzer validate-policy` receives both the existing static findings AND a second-opinion semantic review from an LLM-backed advisor that catches patterns static rules cannot enumerate — most importantly `Principal: "*"` in trust policies. The dual review is exposed as a `--deep-review` flag on `validate-policy` and as a CDK construct that runs during synth. *Success criterion: the catch rate on public-principal trust-policy misconfigurations in pre-production reaches 95%, at a per-policy cost under $0.10.*

---

## Bright spots

The friction surfaces above are real and worth fixing, but the IAM team has shipped genuine bright spots worth naming. **Unused Access Analyzer** returned findings within 55 seconds of being enabled and independently surfaced the `cfn-exec-role` overprovisioning observation in entry #6 — proof that the unused-access tool works fast and produces actionable findings; it is under-discovered relative to `validate-policy`. **Origin Access Control** (the modern replacement for OAI) is a clean modernization, and CDK's `S3BucketOrigin.withOriginAccessControl` makes it invisible. **CDK's grant helpers** save users from many handcrafted IAM mistakes even when they overprovision. None of this justifies ignoring the gaps above, but a doc that only listed frictions would mislead the reader about where the team stands.

---

## Appendix A — Full pain log (32 entries)

Full text of every entry is in [`pain-log.md`](../pain-log.md) in the repo. This table summarizes each by short title, severity, and whether it appears in the top 10 above.

| Day | Title (short) | Severity | Body §? |
|---|---|---|---|
| **D1** | Root MFA "required in 33 days" — required for what? | low | — |
| **D1** | IAM vs IAM Identity Center — near-identical names in same console group | medium | — |
| **D1** | Naming inconsistency: IAM "policies" vs IdC "permission set" | low-medium | — |
| **D1** | `aws configure sso` "SSO session name" prompt has no inline help | low | — |
| **D1** | After IdC sign-in, browser lands on portal, not the in-flight CLI auth prompt | medium | — |
| **D1** | `aws configure sso` browser flow doesn't explain which credentials to enter | medium | — |
| **D1** | IdC console doesn't signal "now go configure your CLI" | medium | — |
| **D1** | IdC home region permanent at create; multi-region announcement amplifies the trap | medium-high | **§8** |
| **D2** | Fresh `cdk init` ships deprecated transitive dependencies | low | — |
| **D2** | `cdk bootstrap` silently creates 5 IAM roles + 4 supporting resources | medium-high | **§5** |
| **D2** | `cfn-exec-role` carries `AdministratorAccess` by default; `iam:PassRole` chain invisible | medium-high | **§6** |
| **D2** | `cdk deploy` IAM Statement Changes prompt: consent newcomers can't give | medium-high | **§7** |
| **D3** | Cognito User Pool Authorizer accepts ID token, rejects Access token; identical 401s | medium-high | **§10** |
| **D4** | CDK `grantReadWriteData()` overprovisions: 12 actions for an app using 3 | medium | — |
| **D4** | DynamoDB `LeadingKeys` condition keys vs Lambda backend reality | high | **§4** |
| **D5** | KMS "double grant" is conditional — default key policy hides the requirement | high | **§2** |
| **D5** | KMS access-denied tells which side failed, not which side to fix | medium | — |
| **D5** | CDK `grantEncryptDecrypt` grants 4 KMS actions when Lambda uses 2 | low | — |
| **D5** | `aws kms get-key-policy` rejects key aliases — CLI identifier inconsistency | low | — |
| **D6** | CDK CORS is half-abstracted: preflight via stack config, response headers via Lambda code | medium-high | — |
| **D6** | API Gateway CORS has three independent surfaces; third fails only after token expiry | high | **§3** |
| **D7** | AA `validate-policy` misses overprovisioning by design — separate tool covers it | medium | — |
| **D7** | AA `validate-policy` gives misleading errors on trust policies without the resource-type hint | medium | — |
| **D7** | AA `validate-policy` MISSES `Principal: "*"` in trust policies — public-principal anti-pattern | high | **§1** |
| **D7** | AA Unused Access Analyzer is fast and effective (positive — see Bright Spots) | low | — |
| **Phase A** | Bedrock model access has 3 independent gating layers, each with different cryptic errors | medium-high | **§9** |
| **Phase A** | Bedrock Model Access page was retired but the Anthropic use-case-form gate remains | medium-high | **§9** |
| **Phase A** | Bedrock has a 4th gating layer (sales-tier gate on newest top-tier models) | medium-high | **§9** |
| **Phase A** | AI advisor caught 4 of 5 patterns AA missed at ~$0.06/review (positive — see AI experiment) | n/a | callout |
| **Phase C** | Cognito group changes require a token refresh; new claims invisible until re-auth | medium | — |
| **Phase C** | `cognito:groups` claim is sometimes a string, sometimes an array — type-unsafe | medium-high | — |
| **Phase C** | `AdminCreateUser` + `AdminAddUserToGroup` is not atomic — orphan user risk | medium | — |

---

## Appendix B — AI advisor vs IAM Access Analyzer, per policy

Model: Claude Opus 4.6 on Amazon Bedrock via the `us.anthropic.claude-opus-4-6-v1` inference profile. Each policy is the same input file given to both tools.

| Test policy | AA `validate-policy` findings | AI advisor findings | AI caught what AA missed? |
|---|---|---|---|
| 1. Real Lambda execution policy (baseline) | 0 | 3 (low-severity hygiene: missing Sid, broad KMS wildcards, missing conditions) | Yes (overprovisioning patterns) |
| 2. Full admin (`"*":"*"` on `"*"`) | 2 (CreateServiceLinkedRole + PassRole warnings) | 4 (incl. wildcard-action HIGH, privilege-escalation HIGH, missing-condition MED) | Yes (deeper coverage) |
| 3. Public trust policy (`Principal: "*"`) | **0** | 3 (incl. **public-principal HIGH**) | **Yes — the headline catch** |
| 4. Action/resource mismatch (`s3:GetObject` on IAM role ARN) | 0 | 2 (incl. action-resource-mismatch HIGH) | Yes |
| 5. `kms:*` on `*` | 0 | 5 (incl. wildcard-action HIGH, privilege-escalation HIGH, wildcard-resource HIGH) | Yes |

Cost: **$0.30 total across 5 reviews** (≈ $0.06 per policy). Full per-finding text in [`docs/ai-vs-aa-comparison.md`](ai-vs-aa-comparison.md).

---

## Appendix C — References

- **Live demo**: <https://d27nvg04sp0g9m.cloudfront.net>
- **Code**: <https://github.com/cheers-nl/iam>
- **Full pain log**: [`pain-log.md`](../pain-log.md)
- **AI advisor implementation**: [`app/policy-advisor/index.ts`](../app/policy-advisor/index.ts)
- **CDK stack (single file)**: [`infra/lib/team-vault-lite-stack.ts`](../infra/lib/team-vault-lite-stack.ts)
- **Prior-art reference**: I previously worked on [Stellen](https://stellenapp.com/), a small-business team platform where organizational accounts share internal credentials (Stripe, SendGrid, social-media admins, etc.) across their team. That product used a single self-managed AES-256-GCM key held in a process environment variable, with ciphertext stored in Postgres and a custom application-level access log. The contrast between that stack and the AWS-native primitives used here (KMS-managed envelope encryption, CloudTrail-captured key use, DynamoDB-backed audit, IAM-scoped access via Cognito groups) sharpened several of the friction observations above — particularly entry #2 (KMS double grant), entry #6 (`cfn-exec-role` overprovisioning), and the AI advisor experiment.

---

*End of report.*

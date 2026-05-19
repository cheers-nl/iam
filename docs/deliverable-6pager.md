# AWS IAM: Day 1 Build Report — Team Vault

## Executive summary

Building Team Vault surfaced a consistent IAM pattern: the hardest friction was not missing AWS capability, but discovering which IAM-adjacent capability applied at the moment of need. The clearest example is IAM Access Analyzer — `check-no-public-access` correctly fails a public-principal trust policy (`Principal: "*"`), but `validate-policy` (the path positioned in AWS tooling and docs as the pre-deploy policy check) neither catches the case nor routes the user to the adjacent check. A Bedrock-backed advisor I prototyped caught the same case at the `validate-policy` moment, which points to workflow integration as the product gap. The 8-day build produced 32 IAM-adjacent friction observations and four product opportunities: surface AWS-created IAM surface at the moment of creation, collapse cross-service contracts into one guided pattern, translate machine errors into next-step actions, and route customers across the Access Analyzer tool surface.

## Who is the customer?

A small B2B SaaS team in a compliance-adjacent vertical manages 40+ third-party credentials: Stripe, SendGrid, Datadog, OpenAI, customer-specific tokens, and CI/CD signing keys. Their largest customer contract bars storing payment-flow credentials in third-party SaaS, which pushes them to build a team vault inside their own AWS account.

## What is the customer problem?

Some teams cannot use a third-party password manager for specific operational credentials because customer contracts, audit requirements, or sovereignty constraints require those credentials to remain inside their AWS account. The hard part is not encrypting one password. The hard part is composing Cognito, KMS, DynamoDB, API Gateway, CloudFront, CDK, and IAM Access Analyzer into a safe workflow while each service exposes a different IAM surface.

This scenario is grounded in prior product experience with the same problem class. At **Stellen** ([stellenapp.com](https://stellenapp.com/)), I helped design a credential-sharing feature for organizational accounts; that earlier system used Postgres, application-level authorization, and a self-managed AES-256-GCM key. Rebuilding the same customer problem on AWS primitives made the IAM tradeoffs visible.

## What is built?

Team Vault is a single-tenant AWS-hosted credential manager for teams that need shared secrets, role-based access, encryption, and audit inside their own AWS account. Admins can create, reveal, delete, audit, and invite members. Members can list and reveal secrets. Self-signup is disabled; membership is invite-only through Cognito admin APIs. Each secret uses KMS envelope encryption: Lambda calls `GenerateDataKey` with an encryption context, encrypts locally with AES-256-GCM, stores ciphertext plus the encrypted data key in DynamoDB, and calls `Decrypt` only during reveal. The DynamoDB table itself is encrypted with the same customer-managed key. The application writes audit events for `CREATE`, `REVEAL`, `DELETE`, and `INVITE`; KMS key use is separately captured by CloudTrail.

Architecture: Cognito Hosted UI → CloudFront/S3 SPA → API Gateway with Cognito authorizer → Lambda → DynamoDB + KMS.

## How is Team Vault built?

1. **Account guardrails.** Enable root MFA, configure a low-spend budget alarm, enable IAM Identity Center, choose a permanent home region, and stand up admin access through the SSO CLI.
2. **Infrastructure-as-Code.** Install AWS CDK, run `cdk bootstrap` once per region, inspect the IAM roles it creates, and deploy a hello-world Lambda behind API Gateway.
3. **End-user authentication.** Stand up a Cognito user pool, enable the Hosted UI, attach a Cognito authorizer to API Gateway, and verify that ID tokens reach Lambda as claims.
4. **Scoped storage.** Introduce DynamoDB with a single-table design. Read and write secrets scoped first by user identity, later refactored to team identity.
5. **Envelope encryption.** Create a customer-managed KMS key with annual rotation. Switch the handler to `GenerateDataKey` on write and `Decrypt` on read so plaintext exists only in Lambda memory during a single request.
6. **Web frontend.** Build a Vite + React SPA. Host it on a private S3 bucket served through CloudFront with Origin Access Control. Wire OAuth to Cognito's Hosted UI with PKCE.
7. **Roles, audit, and invitation.** Create Cognito groups (`vault-admin`, `vault-member`) for roles. Gate sensitive endpoints on the `cognito:groups` claim. Add audit-log, delete, and member-invitation endpoints.
8. **Policy validation.** Run IAM Access Analyzer's `validate-policy`, `check-no-public-access`, and unused-access analysis against the deployed policies and test policies to compare what each tool catches.

## What are the top IAM friction points?

| # | Friction point | Why it matters | Product suggestion |
|---:|---|---|---|
| 1 | `validate-policy` did not route a `Principal: "*"` trust policy to `check-no-public-access`. AWS has the detection capability, but it lives in a separate command. | The pre-deploy validation path returns no findings on a high-impact misconfiguration. The customer must already know `check-no-public-access` exists to find it. Risky policies move downstream to review, support, or production. | Have `validate-policy` fan out to the specialized public-access check when resource type is known, or return a next-step hint naming `check-no-public-access` and external-access analysis. |
| 2 | KMS access depends on both key policy and identity policy, but the default root statement silently enables IAM delegation. | Teams adopting encryption misdiagnose access failures, over-grant to get unstuck, or avoid customer-managed keys. The "double grant" contract is real but the default makes it invisible. | Label the root statement as "enables IAM policy delegation" in console, CDK output, and error messages. Add a preflight check that names which side of the contract is missing. |
| 3 | API Gateway CORS has three independent configuration surfaces: preflight, Lambda response, and gateway responses for 401/403. | All three failures collapse into the same browser `Failed to fetch` error, so engineers debug frontend, auth, and API layers without knowing which one failed. The third surface only fails after token expiry, often hours later. | Provide one API-level `corsContract` property for Cognito-protected APIs that applies to all three surfaces. As a minimum, a CDK synth warning when preflight is configured but gateway responses are not. |
| 4 | DynamoDB `LeadingKeys` promises per-row IAM enforcement, but the Lambda execution-role pattern collapses all users to one principal. | Per-user IAM row scoping requires `sts:AssumeRole` with session tags, which most teams skip. The result: app-only authorization even when IAM has a marquee condition-key primitive for exactly this case. | Publish a first-class CDK construct (e.g., `ScopedDynamoTable`) for Lambda plus DynamoDB scoped access, with session-tag propagation, sample policies, and failure-mode tests. Alternative: extend API Gateway's Cognito authorizer to pass `cognito:sub` as a session tag automatically. |
| 5 | `cdk bootstrap` silently creates five IAM roles plus supporting resources. | The first infrastructure step feels like hidden permission expansion. Trust and pass-role chains are invisible to the user; regulated teams escalate this to security review. | Print a purpose table for each role/resource before creation. After creation, add `cdk bootstrap --show-resources` for post-hoc inspection. |
| 6 | CDK's default `cfn-exec-role` carries `AdministratorAccess`. | The deploy path (user → deploy role → CloudFormation → admin execution role) is not taught at the consent moment. Regulated teams block CDK adoption if the default appears to require account-wide admin. | Offer a guided least-privilege bootstrap profile for common app shapes. Explain the deploy-role-to-execution-role chain in `cdk deploy` output. |
| 7 | CDK's IAM change prompt lists statements uniformly — routine plumbing and broad grants look equally opaque. | Customers learn to approve IAM changes they cannot evaluate, undermining the prompt's security goal. The pattern likely produces more silent overgrant than informed consent. | Add plain-language annotations, a blast-radius summary, and a "new broad permissions" callout before the y/n prompt. |
| 8 | IAM Identity Center home region is permanent, but the enablement screen does not say so. | Region choice happens early, before customers understand permanence. The newer multi-region feature can be misread as making the home region mutable. Mistake requires a new account. | Put the permanence warning on the enablement screen. Distinguish replication from home-region mutability in console copy and docs. |
| 9 | Cognito group changes require token refresh — the newly-assigned `cognito:groups` claim is invisible until re-authentication. | API Gateway authorizer caching can extend the gap further. Admins debug confusing 403s as IAM or API defects when the cause is token staleness. | State the re-authentication requirement in Cognito console and `AdminAddUserToGroup` docs. In API Gateway, warn when authorizer caching may delay permission changes after a group change. |
| 10 | API Gateway's Cognito authorizer accepts ID tokens but rejects access tokens — opposite of OAuth 2.0 convention. | Wrong-token, expired-token, and malformed-token failures all return generic 401s, so customers debug the wrong layer. This is a common newcomer gotcha that contradicts OAuth intuition. | Differentiate wrong token type, expired token, and malformed token in authorizer responses. Include a one-line link to the expected token type for API Gateway. |

*Supporting evidence for #1: a Bedrock-backed advisor prototype caught this case at the `validate-policy` moment, which suggests the gap is workflow integration rather than missing detection capability.*

## Product opportunities

The pattern across these observations is not that IAM lacks primitives. The primitives usually exist. The opportunity is to make the right primitive visible at the moment the customer needs it.

1. **Surface AWS-created IAM surface when AWS creates it.** Bootstrap, KMS defaults, Identity Center setup, and `cdk deploy` prompts should show newly created or newly expanded permissions with purpose labels. This reduces hidden trust boundaries and makes security review faster.
2. **Collapse cross-service contracts into one guided surface.** CORS, KMS grants, Cognito authorizers, and DynamoDB row scoping each require configuration across services. Higher-level CDK patterns would reduce setup time and lower support burden for common customer architectures.
3. **Turn machine errors into next-step actions.** Wrong token type, stale Cognito group claims, missing CORS on gateway responses, and KMS policy-side failures should name the failing layer and the next action. This converts generic access failures into self-service recovery.
4. **Route customers across the Access Analyzer tool surface.** `validate-policy`, `check-no-public-access`, and unused-access analysis answer different questions. The product should guide customers from one surface to the adjacent one instead of requiring them to already know the map.

## Evidence: 29 IAM friction observations logged during the build

The Top 10 above are distilled from these 29 IAM friction observations captured during the 8-day build. Tags `(→ Top 10 #X)` mark entries that distill directly into the Top 10 table; the full source pain log is at [`pain-log.md`](../pain-log.md).

1. Root MFA banner said "required in 33 days" without explaining what enforcement meant.
2. IAM and IAM Identity Center appeared side by side with names that did not explain the difference.
3. IAM "policies" and Identity Center "permission sets" used different names for related concepts.
4. `aws configure sso` asked for an SSO session name without inline help.
5. The SSO browser flow landed on the access portal instead of completing the CLI device authorization.
6. The SSO browser flow did not explain that it needed Identity Center credentials, not root credentials.
7. Identity Center setup did not signal that CLI configuration was a separate next step.
8. `cdk bootstrap` created five IAM roles and supporting resources without a consent summary. *(→ Top 10 #5)*
9. The Bedrock-backed advisor I prototyped flagged a prompt-injection `Sid` as an indicator of compromise; `validate-policy` treated the same value as inert text.
10. Cognito group changes required re-authentication before new claims appeared. *(→ Top 10 #9)*
11. The `cognito:groups` claim appeared as different shapes across paths, forcing defensive parsing in authorization code.
12. `AdminCreateUser` plus `AdminAddUserToGroup` created a non-atomic invitation flow with orphan-user risk.
13. `validate-policy` missed overprovisioning that unused-access analysis later flagged.
14. `validate-policy` gave misleading trust-policy errors unless the resource-type hint was known.
15. `validate-policy` did not route public-principal trust policies to `check-no-public-access`. *(→ Top 10 #1)*
16. Unused Access Analyzer was fast and useful, and independently validated CDK bootstrap overprovisioning.
17. CDK half-abstracted CORS: preflight lived in stack config while response headers lived in Lambda code.
18. API Gateway CORS had three independent surfaces, including gateway responses for generated 401/403s. *(→ Top 10 #3)*
19. KMS access required key-policy and identity-policy alignment, but the default delegation rule hid the relationship. *(→ Top 10 #2)*
20. KMS access-denied errors named the failing side but did not hint at the other side of the contract.
21. CDK's `grantEncryptDecrypt` added more KMS actions than the Lambda used.
22. `aws kms get-key-policy` rejected key aliases, unlike other KMS commands that accept aliases.
23. CDK's `grantReadWriteData()` expanded to twelve DynamoDB actions for an app that needed three.
24. DynamoDB `LeadingKeys` promised row-level IAM enforcement but was hard to wire through Lambda backends. *(→ Top 10 #4)*
25. API Gateway's Cognito authorizer accepted ID tokens but rejected access tokens. *(→ Top 10 #10)*
26. `cdk deploy` IAM statement changes asked for consent a newcomer could not meaningfully evaluate. *(→ Top 10 #7)*
27. CDK's `cfn-exec-role` carried `AdministratorAccess` by default. *(→ Top 10 #6)*
28. Fresh `cdk init` emitted deprecated dependency and Node warnings.
29. Identity Center home region was permanent, but the setup flow did not make that clear. *(→ Top 10 #8)*

---

## Appendix

### A. Links and demo access

- **[Live demo](https://d27nvg04sp0g9m.cloudfront.net)** *(available through 2026-05-25; the stack is torn down within 24 hours of the D8 review to limit ongoing costs. Screenshots in [`docs/screenshots/`](screenshots/) are the post-tear-down fallback.)*
- **[Code](https://github.com/cheers-nl/iam)**
- **CDK stack**: [`infra/lib/team-vault-lite-stack.ts`](../infra/lib/team-vault-lite-stack.ts)
- **Full pain log source**: [`pain-log.md`](../pain-log.md)

### B. FAQ

1. **Why is a single-team credential vault worth IAM team attention?**

   Single-team credential vaults exercise IAM's primitives at depth: KMS double-grant, Identity Center home-region permanence, Cognito group claims, IAM-scoped DynamoDB, CDK bootstrap roles, and API Gateway authorization. Larger teams building higher-stakes systems encounter the same service boundaries. The customer scenario is a representative composite drawn from prior product experience with the same problem class.

2. **Which observations are newcomer-only, and which are systemic product opportunities?**

   `cdk bootstrap` role creation and Identity Center home-region permanence are strongest on the first build, though they still affect account setup quality. KMS double-grant, API Gateway CORS, DynamoDB `LeadingKeys` behind Lambda, Cognito token semantics, and Access Analyzer routing are systemic because they recur in production architectures, not just onboarding.

3. **What would I validate next with the team?**

   I would compare these 32 build observations against customer feedback channels, support cases, and Access Analyzer usage data. The highest-value measurement would be: how often does a customer policy pass `validate-policy` but fail an adjacent specialized analysis such as `check-no-public-access` or unused-access analysis?

# AWS-native Team Vault Build Report

## Executive summary

Building Team Vault surfaced a consistent IAM pattern: the hardest friction was not missing AWS capability, but discovering which IAM-adjacent capability applied at the moment of need. The clearest example is IAM Access Analyzer — `check-no-public-access` correctly fails a public-principal trust policy (`Principal: "*"`), but `validate-policy` (the path positioned in AWS tooling and docs as the pre-deploy policy check) neither catches the case nor routes the user to the adjacent check. A Bedrock-backed advisor I prototyped caught the same case at the `validate-policy` moment, supporting workflow integration as the product gap. The 8-day build produced 32 IAM-adjacent friction observations and four product opportunities: surface AWS-created IAM surface at the moment of creation, collapse cross-service contracts into one guided pattern, translate machine errors into next-step actions, and route customers across the Access Analyzer tool surface.

## Who is the customer?

A small B2B SaaS team in a compliance-adjacent vertical manages 40+ third-party credentials: Stripe, SendGrid, Datadog, OpenAI, customer-specific tokens, and CI/CD signing keys. Their largest customer contract bars storing payment-flow credentials in third-party SaaS, which pushes them to build a team vault inside their own AWS account.

## What is the customer problem?

Some teams cannot use a third-party password manager for specific operational credentials because customer contracts, audit requirements, or sovereignty constraints require those credentials to remain inside their AWS account. The hard part is not encrypting one password. The hard part is composing Cognito, KMS, DynamoDB, API Gateway, CloudFront, CDK, and IAM Access Analyzer into a safe workflow while each service exposes a different IAM surface.

This scenario is grounded in prior product experience with the same problem class. At **Stellen** ([stellenapp.com](https://stellenapp.com/)), I helped design a credential-sharing feature for organizational accounts; that earlier system used Postgres, application-level authorization, and a self-managed AES-256-GCM key. Rebuilding the same customer problem on AWS primitives made the IAM tradeoffs visible.

## What is built?

Team Vault is a single-tenant AWS-hosted credential manager for teams that need shared secrets, role-based access, encryption, and audit inside their own AWS account. Admins can create, reveal, delete, audit, and invite members. Members can list and reveal secrets. Self-signup is disabled; membership is invite-only through Cognito admin APIs. Each secret uses KMS envelope encryption: Lambda calls `GenerateDataKey` with an encryption context, encrypts locally with AES-256-GCM, stores ciphertext plus the encrypted data key in DynamoDB, and calls `Decrypt` only during reveal. The DynamoDB table itself is encrypted with the same customer-managed key. The application writes audit events for `CREATE`, `REVEAL`, `DELETE`, and `INVITE`; KMS key use is separately captured by CloudTrail.

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

1. **Access Analyzer routing gap.** `validate-policy` did not route a `Principal: "*"` trust policy to `check-no-public-access`. AWS has the detection capability, but the pre-deploy policy path can still return no findings at the moment a customer is looking for validation. This weakens trust in IAM tooling and increases the chance that risky policies move downstream to review, support, or production. **Product suggestion:** when resource type is known, have `validate-policy` fan out to the specialized public-access check or return a next-step hint that names `check-no-public-access` and external-access analysis. As supporting evidence, a Bedrock-backed advisor I prototyped (Claude Opus 4.6, ~$0.01–$0.06 per review) caught the same case at the `validate-policy` moment plus three other semantic patterns on the same fixture set; on a prompt-injection test fixture, the advisor recognized the metadata-level injection attempt as an indicator of compromise rather than complying with it. This points to a productized `--deep-review` mode on `validate-policy` as a complement to static rules, with budget and rate guardrails.

2. **KMS double-grant confusion.** KMS access depends on both key policy and identity policy, but the default root statement silently enables IAM delegation. Teams adopting encryption can misdiagnose access failures, over-grant to get unstuck, or avoid customer-managed keys. **Product suggestion:** in KMS console, CDK output, and error messages, label the root statement as "enables IAM policy delegation" and add a preflight check that names which side of the contract is missing.

3. **API Gateway CORS split across three surfaces.** Preflight, Lambda responses, and gateway-generated 401/403 responses each need headers. All three failures collapse into browser `Failed to fetch`, so engineers debug frontend, auth, and API layers without knowing which one failed. **Product suggestion:** provide one API-level CORS contract for Cognito-protected APIs, or at minimum a CDK synth warning when preflight is configured but gateway responses are not.

4. **DynamoDB row scoping is hard behind Lambda.** `LeadingKeys` promises per-row IAM enforcement, but the common browser to API Gateway to Lambda pattern has one execution role. Per-user IAM row scoping therefore requires session tags and role assumption. Many teams will fall back to app-only authorization even when IAM has a condition-key primitive. **Product suggestion:** publish a first-class CDK pattern for Lambda plus DynamoDB scoped access, including session-tag propagation, sample policies, and failure-mode tests.

5. **`cdk bootstrap` creates hidden IAM surface.** A new account receives five IAM roles plus supporting resources before the user understands the trust and pass-role chain. This makes the first infrastructure step feel like hidden permission expansion. **Product suggestion:** before creation, print a purpose table for each role and resource. After creation, print an inspection command such as `cdk bootstrap --show-resources`.

6. **CDK's default execution role is account-admin by default.** The actual deployment path is user to deploy role to CloudFormation to admin execution role. Regulated teams may block CDK adoption if the default path appears to require account-wide admin. **Product suggestion:** offer a guided least-privilege bootstrap profile for common app shapes, and explain the deploy-role to execution-role chain in `cdk deploy` output.

7. **CDK's IAM prompt asks for consent users cannot evaluate.** The prompt lists statements uniformly, so routine service plumbing and broad grants look equally opaque. Customers learn to approve IAM changes they do not understand. **Product suggestion:** add plain-language annotations, a blast-radius summary, and a "new broad permissions" section before the `y/n` prompt.

8. **IAM Identity Center home region is permanent.** Region choice happens early, before customers understand the permanence. The newer multi-region feature can be misread as making the home region mutable. **Product suggestion:** put the permanence warning on the enablement screen and distinguish replication from home-region mutability.

9. **Cognito group changes require token refresh.** Admins can promote a user, but the user's existing token still lacks the new `cognito:groups` claim. API Gateway authorizer caching can mask the change further. This creates confusing 403s in team products and can look like an IAM or API defect. **Product suggestion:** in Cognito console and `AdminAddUserToGroup` docs, state that users must re-authenticate for new group claims. In API Gateway, warn when Cognito authorizer caching may delay permission changes.

10. **API Gateway Cognito authorizer accepts ID tokens, not access tokens.** This reverses OAuth intuition. Wrong-token, expired-token, and malformed-token failures all return generic 401s, so customers debug the wrong layer. **Product suggestion:** differentiate wrong token type, expired token, and malformed token in authorizer responses, with a link to the expected token type for API Gateway.

## Product opportunities

The pattern across these observations is not that IAM lacks primitives. The primitives usually exist. The opportunity is to make the right primitive visible at the moment the customer needs it.

1. **Surface AWS-created IAM surface when AWS creates it.** Bootstrap, KMS defaults, Identity Center setup, and `cdk deploy` prompts should show newly created or newly expanded permissions with purpose labels. This reduces hidden trust boundaries and makes security review faster.
2. **Collapse cross-service contracts into one guided surface.** CORS, KMS grants, Cognito authorizers, and DynamoDB row scoping each require configuration across services. Higher-level CDK patterns would reduce setup time and lower support burden for common customer architectures.
3. **Turn machine errors into next-step actions.** Wrong token type, stale Cognito group claims, missing CORS on gateway responses, and KMS policy-side failures should name the failing layer and the next action. This converts generic access failures into self-service recovery.
4. **Route customers across the Access Analyzer tool surface.** `validate-policy`, `check-no-public-access`, and unused-access analysis answer different questions. The product should guide customers from one surface to the adjacent one instead of requiring them to already know the map.

## Pain points logged during the build

The Top 10 above are distilled from 32 logged friction moments captured during the 8-day build. The full source remains in [`pain-log.md`](../pain-log.md); the list below keeps the evidence visible without making Kai leave the document.

1. Root MFA banner said "required in 33 days" without explaining what enforcement meant.
2. IAM and IAM Identity Center appeared side by side with names that did not explain the difference.
3. IAM "policies" and Identity Center "permission sets" used different names for related concepts.
4. `aws configure sso` asked for an SSO session name without inline help.
5. The SSO browser flow landed on the access portal instead of completing the CLI device authorization.
6. The SSO browser flow did not explain that it needed Identity Center credentials, not root credentials.
7. Identity Center setup did not signal that CLI configuration was a separate next step.
8. `cdk bootstrap` created five IAM roles and supporting resources without a consent summary.
9. The Bedrock-backed advisor I prototyped flagged a prompt-injection `Sid` as an indicator of compromise; `validate-policy` treated the same value as inert text.
10. Cognito group changes required re-authentication before new claims appeared.
11. The `cognito:groups` claim appeared as different shapes across paths, forcing defensive parsing in authorization code.
12. `AdminCreateUser` plus `AdminAddUserToGroup` created a non-atomic invitation flow with orphan-user risk.
13. Bedrock access had a sales-tier gate discoverable only by trial and error on newer top-tier models.
14. The Bedrock Model Access page had changed, but the Anthropic use-case form gate still existed.
15. Bedrock model access had multiple gates that produced different cryptic access errors.
16. `validate-policy` missed overprovisioning that unused-access analysis later flagged.
17. `validate-policy` gave misleading trust-policy errors unless the resource-type hint was known.
18. `validate-policy` did not route public-principal trust policies to `check-no-public-access`.
19. Unused Access Analyzer was fast and useful, and independently validated CDK bootstrap overprovisioning.
20. CDK half-abstracted CORS: preflight lived in stack config while response headers lived in Lambda code.
21. API Gateway CORS had three independent surfaces, including gateway responses for generated 401/403s.
22. KMS access required key-policy and identity-policy alignment, but the default delegation rule hid the relationship.
23. KMS access-denied errors named the failing side but did not hint at the other side of the contract.
24. CDK's `grantEncryptDecrypt` added more KMS actions than the Lambda used.
25. `aws kms get-key-policy` rejected key aliases, unlike other KMS commands that accept aliases.
26. CDK's `grantReadWriteData()` expanded to twelve DynamoDB actions for an app that needed three.
27. DynamoDB `LeadingKeys` promised row-level IAM enforcement but was hard to wire through Lambda backends.
28. API Gateway's Cognito authorizer accepted ID tokens but rejected access tokens.
29. `cdk deploy` IAM statement changes asked for consent a newcomer could not meaningfully evaluate.
30. CDK's `cfn-exec-role` carried `AdministratorAccess` by default.
31. Fresh `cdk init` emitted deprecated dependency and Node warnings.
32. Identity Center home region was permanent, but the setup flow did not make that clear.

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

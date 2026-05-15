# Team Vault Lite — IAM Pain Log

> Captured during onboarding build, 2026-05-13 onward.
> Format reference: handoff §10 at `~/Documents/aws-iam-onboarding/handoff-context.md`.

## Discipline

- Capture entries **when the pain happens**, not at end of day. End-of-day reconstruction loses texture.
- If stuck **>20 min** on something, it's an entry.
- Predicted ≠ encountered. Predictions live in the reference analysis; this log records only friction actually hit.
- Encountered ≠ predicted. Un-predicted pain points are the highest-value entries — flag them clearly.

## Entry template

Copy this block for each new entry:

- **What I was trying to do**: _one line_
- **Friction**: _1–3 lines on what blocked or confused me_
- **What would have been easier**: _one line — the PM suggestion_
- **Category**: Permissions | Credentials | Authentication | Authorization | Tooling | Docs
- **Service(s)**: _e.g., Cognito + Lambda + API Gateway_
- **Severity**: low | medium | high

---

## Account context

- **Account:** Pre-existing personal free-tier AWS account (chosen 2026-05-13 over opening a fresh one). Implication for pain log: "first-time account opening" friction surface is skipped; pre-existing IAM/region/MFA state may need to be acknowledged or normalized as we encounter it.
- **Physical location:** Seattle. Region: **us-west-2** (Oregon) for all work.
- **Root MFA:** TOTP via authenticator app (no FIDO2 hardware key on hand).
- **Identity Center home region (permanent — cannot be changed):** us-west-2.
- **GitHub:** repo `cheers-nl/iam`, private, personal git identity.

---

## Entries

### 2026-05-13 — "Required in 33 days" — required for what, exactly?

- **What I was trying to do**: Sign in as root for the first time to begin AWS account setup for the project.
- **Friction**: Immediately after sign-in, AWS prompted with "Keep your account secure" and a banner: *"Registering your MFA for root credentials will be required in 33 days."* Ambiguous. Does "required in 33 days" mean (a) my account will be locked if I don't enroll within 33 days, (b) AWS will *start enforcing* root MFA on logins after 33 days, or (c) it's a soft nudge and I can dismiss it? I genuinely did not know whether to set it up now or skip — paused the entire onboarding to ask. Compounding factors: the MFA device name field has an odd allowed-character set (alphanumeric plus `+ = , . @ - _`) shown only in fine print, and the "AWS recommends Passkey or Security key" framing without a clear "use this if you don't have a hardware key" pointer left me uncertain whether the Authenticator app path was second-class.
- **What would have been easier**: A clearer banner — *"After 2026-06-15, root sign-in will require MFA. Setting up now takes 2 minutes. [Set up now] [Remind me later]"* — plus a sub-line: *"No hardware key? Authenticator app is fine."*
- **Category**: Authentication / Docs
- **Service(s)**: AWS Console / Root user MFA
- **Severity**: low — but instructive. First-impression friction sets the tone for the rest of onboarding.

### 2026-05-13 — "IAM" vs "IAM Identity Center" — same family, near-identical names

- **What I was trying to do**: Navigate from the AWS console to enable IAM Identity Center to set up human admin login.
- **Friction**: The two services "IAM" and "IAM Identity Center" sit in the same console service category with near-identical names. From the outside with no prior context, the difference — IAM is for service-to-service identities and (legacy) IAM users; IAM Identity Center is the modern way to manage human users via SSO — is not signaled by the naming or by their proximity in the console. A newcomer is left guessing whether one supersedes the other, whether both are required, or whether the "newer-named" one is always the right choice. The naming similarity is severe enough that even after clicking into one I had to confirm I was in the right service.
- **What would have been easier**: A one-line clarification on the IAM Identity Center landing card — *"This is the modern way to manage human users. IAM (the other service) is for service principals and legacy IAM users."* OR rename one of them to make the relationship explicit. The previous name "AWS SSO" was significantly less ambiguous; the rename to "IAM Identity Center" introduced this confusion.
- **Category**: Docs / Tooling
- **Service(s)**: IAM + IAM Identity Center
- **Severity**: medium — every newcomer will hit this; cost is several minutes of "which one do I open?"

### 2026-05-13 — Naming inconsistency: IAM "policies" vs Identity Center "permission set"

- **What I was trying to do**: Create a permission set in IAM Identity Center to grant my user AdministratorAccess. While doing it, paused to wonder how "permission set" relates to the "policies" I had heard about in IAM.
- **Friction**: AWS uses two distinct names for closely related concepts. IAM exposes "policies" (JSON documents defining permissions). Identity Center exposes "permission sets" (named bundles that *contain* one or more IAM policies). Functionally a permission set is just IAM policies wrapped in an SSO-aware shell. But the naming gives no signal of the containment relationship. A newcomer is left wondering: is a permission set a special kind of policy? Multiple policies? An evolution of policies? The distinction matters only because Identity Center can't directly attach IAM policies to users — it has to wrap them in permission sets — but that constraint isn't visible from the names. This compounds the broader "IAM and IAM Identity Center feel like they should be one thing" confusion.
- **What would have been easier**: Either rename "permission set" to something that signals the relationship — e.g., "policy bundle" or "policy group" (parallel to "policies") — OR keep "permission set" but surface a one-line explanation on the permission set creation screen: *"A permission set is a named bundle of one or more IAM policies, scoped to your SSO users."* Consistent naming across the IAM family would meaningfully reduce the newcomer confusion identified in the prior two entries.
- **Category**: Docs / Tooling
- **Service(s)**: IAM + IAM Identity Center
- **Severity**: low-medium — doesn't block, but slows learning and reinforces the broader naming-inconsistency theme across IAM-family services.

### 2026-05-13 — `aws configure sso` "SSO session name" prompt has no inline explanation

- **What I was trying to do**: Run `aws configure sso` for the first time to wire CLI to my IdC identity.
- **Friction**: The very first prompt is `SSO session name (Recommended):` with no help text, no inline explanation, no docs link. I had no idea whether this was supposed to be (a) the name of my IdC instance, (b) a label AWS uses to identify my session in their backend, or (c) a purely local label I'm free to pick. Without context, I had to either guess or stop to look up docs. None of the prompts that follow have inline explanations either — they all assume you already know what they want.
- **What would have been easier**: Inline hint after the prompt: *"This is a local label for this SSO configuration. Pick anything memorable, e.g., `my-org-sso`. You'll reuse it in commands like `aws sso login --sso-session <name>`."* The pattern of "no help text on interactive prompts" runs through the whole `aws configure sso` flow and accumulates pain. A `--guided` or `--explain` flag on `aws configure sso` that produces verbose, hint-rich prompts would solve this without changing the default.
- **Category**: Tooling / Docs
- **Service(s)**: AWS CLI / IdC
- **Severity**: low — doesn't block, but produces a 30-second "huh, what?" pause at every prompt, and a newcomer doing this flow for the first time hits 7-8 of them in a row.

### 2026-05-13 — After IdC sign-in, browser lands on access portal — disconnected from the in-flight CLI authorization

- **What I was trying to do**: Complete the `aws configure sso` flow by signing in through the browser tab it opened.
- **Friction**: After entering my IdC username, password, and MFA code, the browser sent me to the AWS access portal home page — a list of accounts and roles I can access. But the CLI flow I had started was waiting for a *device authorization confirmation* page ("Allow this device to access AWS?") — a page I never saw. The two browser destinations are different URLs and represent different actions, but the post-login redirect treated my sign-in as if I were just visiting the portal casually. The CLI on the other side sat silently in my terminal, eventually timing out without surfacing any "what's wrong" message. The access portal itself gives no indication that I have an in-flight CLI authorization to complete.
- **What would have been easier**:
  - If the access portal detects a recent pending device authorization for the user, surface a banner at the top: *"You started an AWS CLI authorization. Complete it here."*
  - OR have the IdC sign-in flow check the redirect URL and route the user back to the device authorization page if that's where they came from.
  - OR (at minimum) the CLI's auto-opened browser tab could persist the device authorization URL in its history and instruct the user: *"After signing in, return to this tab — don't navigate away."*
- **Category**: Authentication / Tooling / Docs
- **Service(s)**: AWS CLI / IdC access portal
- **Severity**: medium — fully blocks D1 completion until the user figures out to retry the CLI flow; the portal-vs-device-auth disconnect is invisible.

### 2026-05-13 — `aws configure sso` browser flow doesn't explain which credentials to enter

- **What I was trying to do**: Complete the `aws configure sso` flow. After answering the CLI prompts, my browser auto-opened to a sign-in page asking for username and password.
- **Friction**: The CLI doesn't tell you what credentials the browser is asking for. The browser opens to the IdC access portal login page, which expects (a) your IdC user's username, (b) the password you set when accepting your invitation email, and (c) your IdC user's MFA code (separate from your root MFA). But:
  - If you've been working as root in this same browser session, the mental model is "I'm already logged in, why is this asking for credentials again?"
  - The login page doesn't say "Sign in with your IAM Identity Center user — not your root account."
  - The CLI doesn't pre-warn: "A browser will open to your IdC sign-in page. Use your IdC user credentials."
  - If you haven't yet accepted the invitation email (a separate step easily missed), there are *no* IdC credentials to enter — and nothing on the login page hints at this. You stare at a username field with no way forward.
- **What would have been easier**:
  - CLI banner *before* opening the browser: *"A browser will now open to sign in with your IdC user (not your root account). If you haven't set up your IdC user yet, check your email for an invitation from AWS first."*
  - On the access portal login page itself: a prominent header *"Sign in with your Identity Center user. Root account credentials do not work here."*
  - In the IdC console after creating a user: a "Next steps" card explicitly listing "1. The user receives an invitation email, 2. They accept and set password + MFA, 3. CLI / Console access becomes available."
- **Category**: Authentication / Docs / Tooling
- **Service(s)**: AWS CLI / IdC access portal
- **Severity**: medium — actively blocks completion of D1 until resolved; especially confusing because the user has been operating as root and the mental model "switch identity" is never made explicit.

### 2026-05-13 — IdC console doesn't signal "now go configure your CLI" — silent setup gap

- **What I was trying to do**: After completing user creation, permission set creation, and account assignment inside IAM Identity Center (IdC), I expected setup to be done — naturally assumed any further work would continue in the same browser console.
- **Friction**: The IdC console gives no indication that CLI configuration is a separate, required step. After clicking through the user + permission set + assignment trio, the dashboard does not say "next: configure your CLI to use this identity" or "your IdC user is browser-only until you run `aws configure sso`." A newcomer discovers the gap only by (a) reading a tutorial that happens to walk through both surfaces, or (b) trying to run their first AWS API call from code and hitting a credential error. Compounding this: the IdC user is the same identity used for both console login (via the access portal URL) and CLI sessions, but the setup steps are not co-located — and the relationship between "I logged into the access portal" and "I need to run `aws configure sso`" is never made explicit.
- **What would have been easier**: On the IdC dashboard after first successful user assignment, surface a "Next steps" card with two clearly-labeled paths: *"To use the AWS Console, open your access portal URL: [link]"* and *"To use the CLI, SDKs, or CDK, run `aws configure sso`. [docs link]"*. Even better: include the SSO start URL and region prefilled in a copyable code block so users don't have to translate dashboard values into CLI prompts manually.
- **Category**: Docs / Tooling
- **Service(s)**: IAM Identity Center (IdC) + AWS CLI
- **Severity**: medium — almost every newcomer will hit the moment of "wait, I'm not actually done?"; cost ranges from 15 minutes (find a tutorial) to several hours (debug credential errors before realizing CLI needs its own setup).

### 2026-05-13 — `cdk bootstrap` silently creates 5 IAM roles + 4 other resources, no consent prompt, no inline explanation

- **What I was trying to do**: Run `cdk bootstrap --profile personal-admin` for the first time — the standard one-time CDK setup step for a new AWS account + region pair.
- **Friction**: The command silently created 9 substantive AWS resources in my account — 5 IAM roles, 1 S3 bucket, 1 ECR repository, 1 SSM parameter, and the CloudFormation stack (`CDKToolkit`) that owns them — with no consent prompt, no summary of what was being created, and no inline explanation of what each role does or what permissions it carries. The CDK CLI did not pause to confirm. As a newcomer I:
  1. Was not asked whether I wanted these resources created.
  2. Got no explanation of what the 5 IAM roles do or why CDK needs them.
  3. Would not have known the roles existed unless I went looking in the IAM console afterward.
  4. Cannot evaluate whether the failure modes are clear, because the command succeeded — but if it had failed at IAM role creation halfway, I would have an unclear half-bootstrapped state to clean up.
  The role names themselves (`cdk-hnb659fds-deploy-role-...`, `cdk-hnb659fds-cfn-exec-role-...`, etc.) include a meaningless qualifier hash (`hnb659fds`) that a newcomer cannot decode, and don't always make the role's purpose obvious. This is the worst kind of IAM friction: invisible. A user who skipped reading the bootstrap output would have substantial IAM surface in their account without knowing.
- **What would have been easier**:
  - A summary banner before bootstrap: *"This will create in your account: 1 CloudFormation stack, 5 IAM roles, 1 S3 bucket, 1 ECR repository, 1 SSM parameter. Each IAM role's purpose: deploy-role (executes CDK deploys), cfn-exec-role (passed to CloudFormation to manage your stacks), file-publishing-role (uploads Lambda code zips to S3), image-publishing-role (pushes container images to ECR), lookup-role (queries account state during synthesis). Continue? [Y/n]"*
  - For CI/non-interactive use, require an explicit `--accept-defaults` flag.
  - Drop the qualifier hash from role names by default, or surface what it means.
  - After bootstrap, print a "what was created" summary and a `cdk bootstrap --show-resources` follow-up command for re-inspection.
- **Category**: Permissions / Tooling / Docs
- **Service(s)**: AWS CDK + IAM + CloudFormation
- **Severity**: medium-high — invisible IAM is the worst IAM. Every CDK user passes through this step; no one is warned.

### 2026-05-14 — IAM Access Analyzer validate-policy misses overprovisioning by design — the policy "passes" while the unused-access analyzer flags it

- **What I was trying to do**: Run `aws accessanalyzer validate-policy` on our deployed Lambda execution policy to see what AA reports. The policy is the one we observed to overprovision in earlier pain log entries (12 DynamoDB actions for 3 used, 4 KMS actions for 2 used).
- **Friction**: validate-policy returned `"findings": []` — clean bill of health. Yet we know from inspecting the code that the policy grants 9 actions the Lambda never invokes. The reason: **validate-policy is a syntax + best-practices check, not a usage check**. It cannot know whether a given action is "used" by the application code — it only knows whether the policy is well-formed and avoids known-dangerous patterns (PassRole wildcards, malformed condition keys, etc.). To detect overprovisioning, you need a different AA tool: the *unused-access analyzer* (separate API, separate provisioning, separate findings) which observes actual runtime usage over time.
  This **split between two AA tools for two related problems** is undocumented at the "getting started" level. A newcomer who runs validate-policy and gets a clean result will reasonably conclude their policy is fine. They have no signal that they should ALSO be running unused-access. Two tools, two integrations, two findings models — for what feels like "one question: is this policy any good?"
- **What would have been easier**:
  - AA validate-policy's empty-findings response could include an explicit note: *"Static analysis passed. To check whether granted permissions are actually used by your workloads, enable the unused-access analyzer: <link>."*
  - Or unify the two views in a single CLI command: `aws accessanalyzer analyze-policy --policy-arn ... --include-usage` that returns both syntax findings and usage-based findings.
- **Category**: Permissions / Docs / Tooling
- **Service(s)**: AWS IAM Access Analyzer
- **Severity**: medium — users who only know validate-policy never discover the more valuable unused-access feature.

### 2026-05-14 — AA validate-policy gives misleading errors for IAM trust policies unless you know the `--validate-policy-resource-type` hint

- **What I was trying to do**: Validate a deliberately bad trust policy (`Principal: "*"` allowing anyone to assume) to see what AA flags.
- **Friction**: First attempt used `--policy-type RESOURCE_POLICY` (which is correct — trust policies are a kind of resource policy). AA responded with: *"MISSING_RESOURCE: Add a Resource or NotResource element to the policy statement."* This is **wrong for trust policies** — IAM role trust policies do not take a `Resource` element; the resource is implicit (the role being assumed). The error sent me on a 10-minute side quest checking whether I had to add a `Resource` field somewhere. Eventually I discovered the secret incantation: pass `--validate-policy-resource-type 'AWS::IAM::AssumeRolePolicyDocument'`. With that hint, AA stops complaining about the missing Resource — because it now knows it's a trust policy. The hint isn't surfaced prominently in docs; the `--policy-type RESOURCE_POLICY` flag *should* be enough on its own, but isn't.
- **What would have been easier**:
  - AA could detect that a policy with `Principal: {"AWS": ...}, "Action": "sts:AssumeRole"` is overwhelmingly likely a trust policy and validate it as such without requiring the resource-type hint.
  - Or, when MISSING_RESOURCE is reported, append: *"If this is a role trust policy, validate with `--validate-policy-resource-type AWS::IAM::AssumeRolePolicyDocument` instead."*
- **Category**: Tooling / Docs
- **Service(s)**: AWS IAM Access Analyzer
- **Severity**: medium — wastes time for anyone validating a trust policy for the first time.

### 2026-05-14 — AA validate-policy MISSES `Principal: "*"` in trust policies — the canonical IAM mistake passes the analyzer

- **What I was trying to do**: With the correct `--validate-policy-resource-type AWS::IAM::AssumeRolePolicyDocument` flag set, validate a trust policy that allows ANY AWS principal (`Principal: {"AWS": "*"}`) to assume the role — no Condition. This is the canonical configuration that has caused real-world breaches (Capital One, etc.).
- **Friction**: AA's validate-policy returned **zero findings**. The most-dangerous-by-far pattern in IAM trust policies — public assumability with no Condition — passes AA's static validator clean. The presumed reason: AA expects this kind of risk to be caught by its *external-access analyzer* (the continuous one) when the policy is actually attached to a resource. But validate-policy is positioned in tooling and docs as "the synchronous policy check you run before deploying" — exactly the moment when you'd want to be warned about a Principal-star trust policy *before* it reaches AWS. The two AA tools have non-overlapping coverage of the most important IAM mistake, and validate-policy is the one users reach for first.
- **What would have been easier**:
  - validate-policy should treat `Principal: "*"` (or `Principal: {"AWS": "*"}`) without a Condition as at least a SECURITY_WARNING — even if the external-access analyzer also flags it later. Static catching beats runtime catching for a deploy-time guard.
  - Or, doc the gap explicitly: *"validate-policy does not flag overly broad principals; for that, attach the policy to a resource and the external-access analyzer will detect it."*
- **Category**: Permissions / Docs
- **Service(s)**: AWS IAM Access Analyzer
- **Severity**: **high** — this is the highest-impact IAM mistake and AA's most-reached-for tool doesn't catch it. The IAM team should care most about this.

### 2026-05-14 — AA unused-access analyzer is fast and effective, and independently validates the CDK bootstrap overprovisioning observation from D2

- **What I was trying to do**: Enable the unused-access analyzer to see whether it would flag the overprovisioning we observed in D2 / D4 / D5 pain log entries (CDK bootstrap roles, grantReadWriteData, grantEncryptDecrypt — all granting more permissions than the application uses).
- **Friction (positive — captured as a counter-example)**: AWS docs say initial scan "can take several hours." Actual experience: I created the analyzer at 01:33:56 UTC. The first findings appeared at 01:34:51 UTC — **55 seconds later**. AA flagged exactly what I'd predicted from manual inspection:
  - `cdk-hnb659fds-cfn-exec-role` — UnusedPermission (validates D2 pain log entry on AdministratorAccess overprovision)
  - `cdk-hnb659fds-{deploy,lookup,file-publishing}-role` — UnusedPermission (validates the "5 roles, all broad" observation)
  - `cdk-hnb659fds-image-publishing-role` — **UnusedIAMRole** (the entire role is unused, because we use zip-based not container-based Lambdas — exactly the architecture decision I noted in D5)
  - The SSO AdministratorAccess role — UnusedPermission (expected for any admin role)
  - A pile of leftover personal IAM users (`Jane`, `David`, etc.) — UnusedIAMUserPassword + UnusedPermission
  
  This is one of the strongest positive signals in the project: **AA's unused-access analyzer works, is fast, and produces actionable findings**. The pain log up to D6 has been weighted toward IAM frustrations; this entry is a counter-example. **The IAM team has a really good product here that newcomers often don't enable.**
- **What would have been easier**:
  - Make unused-access analyzer **on by default** in new accounts, or surface it prominently in the IAM console landing page (currently buried under "Access Analyzer" in the left nav).
  - Update docs to remove the misleading "scan can take hours" — for small accounts it's near-realtime.
- **Category**: Permissions / Tooling / Docs
- **Service(s)**: AWS IAM Access Analyzer
- **Severity**: low (this is a *positive* finding) — but the docs UX (misleading "hours" claim, discoverability of unused-access vs validate-policy) is real and should improve to widen adoption.

### 2026-05-14 — CORS is half-abstracted in CDK: preflight via stack config, response headers via Lambda code — the seam is undocumented and the failure mode is silent

- **What I was trying to do**: Wire up the React SPA on CloudFront to call the Cognito-protected API on a different origin. Configured `defaultCorsPreflightOptions` on the API Gateway construct, assumed CORS was now "done."
- **Friction**: First load worked — sign-in flow worked, callback exchange returned tokens. But the SPA's first GET `/secrets` call failed with the browser's most-frustrating error: **`Failed to fetch`**. No detail. No stack trace. No hint about CORS. The user-facing experience was a blank state with a red "Failed to fetch" message and no way to diagnose. 
  
  Investigation revealed the gap: **CORS in API Gateway with Lambda proxy integration is a two-part configuration:**
  1. **Preflight side (OPTIONS request)**: API Gateway handles this. CDK's `defaultCorsPreflightOptions` auto-generates OPTIONS methods with the right CORS response headers and (importantly) auto-attaches `AuthorizationType.NONE` so Cognito authorizer doesn't block preflight.
  2. **Actual response side (GET/POST response)**: Lambda's response must include CORS headers (`Access-Control-Allow-Origin`, etc.) directly. `defaultCorsPreflightOptions` **does not** add these to non-OPTIONS responses, because Lambda proxy integration means API Gateway can't mutate the response.
  
  Newcomer experience: configure `defaultCorsPreflightOptions`, verify preflight with `curl -X OPTIONS` (works!), assume CORS is done. Open browser → "Failed to fetch." Spend 30+ minutes wondering if it's CORS, network, or authentication. Eventually discover the Lambda's response is missing CORS headers. Add `Access-Control-Allow-Origin` to the Lambda's `headers` return. Works.
  
  The CDK abstraction is genuinely incomplete here — it solves the harder half (OPTIONS-with-bypass-authorizer) but the easier half (response headers) is dropped silently on the developer. Compounding it, the browser's `Failed to fetch` error is one of the worst error messages in web platform history — it gives zero signal that the issue is CORS.
- **What would have been easier**:
  - A `defaultCorsResponseHeaders` config on `RestApi` that injects headers into all responses (either via Lambda response wrapping or response mapping templates) — completing the CORS abstraction.
  - At minimum, a CDK warning in `defaultCorsPreflightOptions` JSDoc: *"This only handles preflight. Your Lambda function must include `Access-Control-Allow-Origin` in its response headers."*
  - Browsers should improve `Failed to fetch` to surface the underlying cause (CORS, network, DNS, etc.) — but that's not AWS's problem.
- **Category**: Permissions / Tooling / Docs
- **Service(s)**: API Gateway + Lambda + AWS CDK
- **Severity**: medium-high — extremely common newcomer experience; CDK abstracts the hard part but leaves a silent gap in the easy part.

### 2026-05-14 — API Gateway CORS has three independent surfaces — and the third surface (gateway responses) only fails after the first 401

- **What I was trying to do**: After fixing the Lambda response to include CORS headers (entry above), confirm the browser flow worked end-to-end.
- **Friction**: The flow worked on first sign-in. Then I let the page sit. The Cognito ID token expired (1-hour default). I refreshed. The SPA immediately failed with the same useless **`Failed to fetch`** message — but this time the cause was different. With an expired token, API Gateway's Cognito authorizer rejected the request at the *gateway level* and returned a 401 directly, **without invoking the Lambda**. Those gateway-level rejection responses are governed by a *third* CORS configuration surface in API Gateway: the **Gateway Responses** (`apigateway.GatewayResponse` in CDK, configured via `api.addGatewayResponse()`). By default, gateway responses do not include any CORS headers, so the browser blocked the 401, and the SPA saw `Failed to fetch` again with no indication that the underlying issue was an expired token.
  
  The full pattern: API Gateway CORS for a Cognito-protected Lambda has **three independent surfaces** that each need configuration:
  | Surface | Trigger | CDK config | Default state |
  |---|---|---|---|
  | OPTIONS preflight | Browser sends preflight | `defaultCorsPreflightOptions` | No CORS unless set |
  | Lambda 200/4xx response | Lambda invoked successfully | Lambda response headers | No CORS unless set in Lambda code |
  | Gateway 4xx/5xx response | Authorizer rejection, invalid input, etc. | `addGatewayResponse(DEFAULT_4XX)` etc. | No CORS unless set |
  
  Newcomer experience: fix surface 1 (CDK), assume done; hit failure, fix surface 2 (Lambda code), assume done; **let the token expire**, hit failure again with identical error message, spend another 20+ minutes finding the third surface. The three gaps are all silent — none of the failures says "your CORS is missing here."
- **What would have been easier**:
  - CDK should offer a single "enable CORS" config that wires all three surfaces (preflight, Lambda response wrapping, gateway responses).
  - Or, at minimum, the docs for `defaultCorsPreflightOptions` should list the three surfaces explicitly: *"This handles only OPTIONS preflight. You must additionally: (a) set CORS headers in your Lambda response, and (b) call `addGatewayResponse` for DEFAULT_4XX and DEFAULT_5XX to cover authorizer rejections."*
  - Browsers should improve the `Failed to fetch` error to surface the CORS-blocking response details (Chromium has the info in DevTools, but the JS `Error.message` carries nothing).
- **Category**: Permissions / Tooling / Docs
- **Service(s)**: API Gateway + Lambda + AWS CDK + Cognito
- **Severity**: **high** — three-surface design that exposes itself one-at-a-time as you traverse failure paths. Each failure produces the same useless error. This is one of the strongest "AWS service integration friction" examples in the project.

### 2026-05-14 — KMS access requires alignment between key policy and identity policy, but the default delegation rule makes the requirement invisible

- **What I was trying to do**: Understand how `vaultKey.grantEncryptDecrypt(secretsFn)` actually works after deploying. Inspected both the KMS key policy and the Lambda's identity policy in the live account.
- **Friction**: The deployed state surprised me. The KMS key policy has **exactly one statement** — `Effect: Allow, Principal: root, Action: kms:*`. The Lambda role's identity policy has the four KMS actions on the key ARN. The Lambda role is **not mentioned anywhere in the key policy**. Yet encryption and decryption work fine. The reason is a subtle KMS rule that AWS docs gesture at but don't emphasize: **if the key policy grants `kms:*` to the account root, then IAM policies in that account can implicitly grant access to the key.** This is called "IAM delegation" and it's the default behavior. Most documentation describes KMS access as requiring a "double grant" (key policy + identity policy), but in the default case identity policy alone is sufficient *because* the key policy already delegated. This means:
  1. A newcomer reading docs about "you need both policies aligned" sees only the identity-policy half and concludes the docs are wrong (or that CDK is doing magic).
  2. A security-minded user who "tightens" the key policy by removing the root grant (thinking it's overly permissive) will silently break every IAM-based grant on that key — including the CDK-managed ones — without realizing they made the change.
  3. The contract between key policy and identity policy is bidirectional but the "default delegation" mode obscures it.
- **What would have been easier**: 
  - A clear flowchart in KMS docs: *"With default key policy → identity policy alone suffices. Without root grant in key policy → both policies must explicitly allow."*
  - A warning when removing/restricting the root grant: *"Removing this statement will break all IAM-delegated access to this key."*
  - CDK's `grantEncryptDecrypt` output: *"This grant added to identity policy. It works because the key policy delegates to IAM. If you replace the key policy, you must explicitly include this role as a principal."*
- **Category**: Permissions / Docs
- **Service(s)**: KMS + IAM
- **Severity**: **high** — this is the "highest-density IAM pain point" handoff §4 predicted, but the actual shape is even more interesting than "double grant" — it's "subtle conditional double grant where the default makes the condition invisible."

### 2026-05-14 — KMS access denied error tells you which side failed, but doesn't hint at the other side

- **What I was trying to do**: Validate the friction story by deliberately breaking the Lambda's identity-side KMS grant. I removed the KMS statement from the Lambda's IAM role policy via CLI and called the API.
- **Friction**: The error message was actually quite specific:
  > *"User: arn:aws:sts::...:assumed-role/... is not authorized to perform: kms:GenerateDataKey on resource: arn:aws:kms:... because **no identity-based policy allows** the kms:GenerateDataKey action"*
  
  The good: it pinpoints the missing-permission side (identity-based), tells you the action, the principal, and the resource. This is substantially better than the historical "AccessDeniedException" with no detail.
  
  The bad: it does not hint that **even after fixing the identity side, you might also need the key policy to allow it**. A newcomer who adds `kms:GenerateDataKey` to the identity policy of a Lambda accessing a *non-default key policy* (e.g., one without the root grant) will fix the identity-side message, then encounter a *different* error — `"no resource-based policy allows"` — and have to debug the key policy separately. Two-step debugging where one-step messaging would have been possible.
- **What would have been easier**: When IAM denies a KMS action, surface both sides in the same error if both are blocking: *"Access denied. Identity policy: ALLOWS / DENIES / IMPLICIT-DENY. Key policy: ALLOWS / DENIES / IMPLICIT-DENY (via account delegation: yes/no). Fix at least one side."*
- **Category**: Permissions / Docs / Error messages
- **Service(s)**: KMS + IAM
- **Severity**: medium — error messages have improved a lot (this is much better than 5 years ago), but they're still one-sided when the two-sided check is the actual model.

### 2026-05-14 — CDK's `grantEncryptDecrypt` adds 4 KMS actions when our Lambda uses only 2

- **What I was trying to do**: Wire up the Lambda's KMS permissions to do envelope encryption — only `kms:GenerateDataKey` (on write) and `kms:Decrypt` (on read).
- **Friction**: `vaultKey.grantEncryptDecrypt(secretsFn)` produced an identity-policy statement with **four KMS actions**: `kms:Decrypt`, `kms:Encrypt`, `kms:GenerateDataKey*`, `kms:ReEncrypt*`. My code uses two: GenerateDataKey on write and Decrypt on read. The other two — `Encrypt` and `ReEncrypt*` — are unused. `Encrypt` overlaps semantically with GenerateDataKey (both can produce ciphertext), but they're different APIs. `ReEncrypt*` is for re-encrypting an already-encrypted ciphertext under a different key — useful for key rotation, not used by my app. This mirrors the same overprovision pattern from D4's `grantReadWriteData()`: convenience helpers default broad, narrowing requires bypassing the helper entirely.
- **What would have been easier**:
  - More granular helpers — `grantGenerateDataKey()` and `grantDecrypt()` as separate methods (CDK does have these, but the broader `grantEncryptDecrypt` is what's surfaced in tutorials).
  - A "least-privilege mode" flag on the convenience helpers: `grantEncryptDecrypt(fn, { onlyActions: ['Decrypt', 'GenerateDataKey'] })`.
- **Category**: Permissions / Tooling
- **Service(s)**: AWS CDK + IAM + KMS
- **Severity**: low — pattern is now well-established across CDK helpers; cumulative effect is real.

### 2026-05-14 — `aws kms get-key-policy` rejects key aliases — CLI inconsistency in how KMS commands accept identifiers

- **What I was trying to do**: Run `aws kms get-key-policy --key-id alias/team-vault-lite/dek --policy-name default` to inspect the deployed key policy. Using the alias seemed natural since the alias was the only friendly identifier I had memorized.
- **Friction**: Got `InvalidArnException: Key Aliases are not supported for this operation`. Had to switch to the raw key ID (`ec091839-808d-4059-988b-d64e4167b6fd`) which I had to look up from CDK outputs. Other KMS CLI commands (`aws kms encrypt`, `aws kms decrypt`) do accept aliases. The acceptance of identifier types — alias, key ID, key ARN — varies command-by-command without an obvious pattern. As a newcomer trying to be productive, I have to learn this inconsistency by trial-and-error.
- **What would have been easier**: All KMS commands accept all identifier types uniformly. Or, if there's a technical reason for the inconsistency, surface it in the error: *"This operation requires a key ID or ARN. Aliases are not supported because [reason]. Resolve your alias with `aws kms describe-key --key-id alias/your-alias`."*
- **Category**: Tooling / Docs
- **Service(s)**: AWS KMS CLI
- **Severity**: low — a 30-second annoyance per occurrence, but it adds up because KMS commands are common during debugging.

### 2026-05-14 — CDK's `grantReadWriteData()` overprovisions: 11 DynamoDB actions for an app that needs 3

- **What I was trying to do**: Grant my Lambda the permissions it needs to read/write a DynamoDB table. Used CDK's convenience method `table.grantReadWriteData(lambdaFn)`.
- **Friction**: The CDK helper attached an IAM policy with **12 DynamoDB actions**:
  ```
  BatchGetItem, BatchWriteItem, ConditionCheckItem, DeleteItem, DescribeTable,
  GetItem, GetRecords, GetShardIterator, PutItem, Query, Scan, UpdateItem
  ```
  My Lambda actually uses **3**: `PutItem`, `Query`, `GetItem`. The other 9 are unnecessary, and several are concerning:
  - **`Scan`** — a full-table read; expensive and a common cost-incident cause. Granting Scan to a Lambda that doesn't need it is a permission footgun.
  - **`GetRecords` / `GetShardIterator`** — these are DynamoDB Streams actions; my table doesn't have Streams enabled.
  - **`DescribeTable`** — administrative metadata; my app doesn't need it.
  - **`BatchWriteItem`** — bulk operations; not used.
  Convenience methods like `grantReadWriteData` work *against* least-privilege defaults. To do this right I'd have to either (a) compose individual `grantPutItem` + `grantQuery` + `grantGetItem` calls, or (b) write a custom IAM policy by hand. Both are more code than the one-liner I used, so most teams take the one-liner and accept the overprovisioning.
- **What would have been easier**:
  - A CDK convention where `grantReadWriteData` produces a tight default (only DataPlane actions: GetItem, PutItem, UpdateItem, DeleteItem, Query, BatchGet, BatchWrite), with admin/stream actions moved to separate grants.
  - At minimum, surface what was granted in the synth output as a warning: *"Granting 12 DynamoDB actions to Lambda. To narrow, use individual grant methods."*
  - A CDK Aspect / linter rule that flags "Lambda has wildcard or near-wildcard DynamoDB permissions".
- **Category**: Permissions / Tooling
- **Service(s)**: AWS CDK + IAM + DynamoDB
- **Severity**: medium — convenience-vs-security tradeoff baked into the framework default. Compounds with the cdk-bootstrap AdministratorAccess pattern: at every layer of CDK abstraction, defaults favor "it works" over "minimum permissions."

### 2026-05-14 — DynamoDB `LeadingKeys` condition key promises per-row IAM enforcement, but is structurally hard to wire up with Lambda backends

- **What I was trying to do**: Enforce per-user data isolation in the IAM layer rather than the application layer. The canonical approach AWS docs describe is the DynamoDB `dynamodb:LeadingKeys` condition key — bind your IAM policy to "this principal can only access rows whose partition key starts with their identity."
- **Friction**: The pattern is designed for an architecture where each user has their own AWS credentials — typically via Cognito Identity Pool issuing per-user temporary STS credentials with the user's `sub` as a principal tag. In that world, `dynamodb:LeadingKeys` is elegant and works. But for the architecture pattern most likely chosen by a newcomer following AWS's modern tutorials — browser → API Gateway with Cognito User Pool authorizer → Lambda → DynamoDB — there is no per-user IAM identity inside the Lambda. The Lambda has a single execution role used for all users. To make `LeadingKeys` work here you must:
  1. In the Lambda, call `sts:AssumeRole` (or `sts:AssumeRoleWithWebIdentity`) with the user's `sub` as a session tag.
  2. Use the resulting scoped credentials to call DynamoDB.
  3. The Lambda's execution role needs `sts:AssumeRole` plus `sts:TagSession` on a *second* role.
  4. That second role's policy uses `LeadingKeys = ${aws:PrincipalTag/sub}`.
  5. The first role and the second role together implement what 3 lines of application code already do: read `claims.sub` from the JWT and scope queries with `PK = USER#${sub}`.
  In practice, almost everyone defaults to application-level enforcement (this project does, in D4). It works and is verifiable (tested: User B sees no User A data). But the IAM policy doesn't enforce it; if a future bug ever forgets to scope, the policy won't catch it. AWS's most powerful per-row IAM mechanism is structurally inaccessible to AWS's most-documented serverless pattern.
- **What would have been easier**:
  - A CDK higher-level construct — `LambdaScopedDynamoDbHandler` — that wires up the STS-AssumeRole-with-session-tags pattern in one line.
  - Or: an API Gateway Cognito Authorizer mode that propagates scoped STS credentials (not just JWT claims) into the Lambda invocation context.
  - Or, at minimum: documentation that clearly says "If you're using API Gateway + Lambda, here's the architecture decision for IAM-level isolation; here's what it costs; here's what you give up by going app-level."
- **Category**: Authorization / Docs
- **Service(s)**: IAM + DynamoDB + Lambda + Cognito + STS
- **Severity**: **high** — this is a structural gap between IAM's design intent (per-row IAM enforcement is a marquee feature) and the dominant serverless architecture pattern. The "IAM as connective tissue" promise weakens at exactly the integration point where most apps land. A senior PM at IAM should care about this.

### 2026-05-14 — Cognito User Pool Authorizer accepts ID token but rejects Access token — opposite of OAuth 2.0 convention, error message gives no hint

- **What I was trying to do**: Test which JWT type (ID vs Access) the API Gateway Cognito User Pool Authorizer accepts. Both tokens come from the same `admin-initiate-auth` response for the same user.
- **Friction**: Standard OAuth 2.0 convention is that **Access tokens are used to access APIs** and **ID tokens are used to identify the user**. A developer with OAuth literacy approaching Cognito would naturally try the access token first. But the API Gateway Cognito User Pool Authorizer **defaults to accepting only ID tokens** and rejects access tokens with a generic `401 Unauthorized` — identical to the response for a completely invalid token. Tested results:
  - `Authorization: <ID token>` → 200 + Lambda receives `claims.sub` and `claims.email`
  - `Authorization: <Access token>` → 401 `{"message":"Unauthorized"}`
  - `Authorization: not-a-real-jwt` → 401 `{"message":"Unauthorized"}`
  The token payloads themselves make the intended use obvious — ID token has `token_use: "id"` and rich claims (email, etc.); Access token has `token_use: "access"` and OAuth scopes. But the authorizer hides the type-check behind a generic 401. A newcomer learns OAuth, sends the Access token, hits 401, and has no signal pointing to "wrong token type." Expected debugging time: hours.
- **What would have been easier**:
  - Error message that distinguishes token-type rejection from invalid-token rejection: *"401 Unauthorized: token's `token_use` claim is `access`, but this authorizer expects `id`. Send the ID token, or configure your authorizer's `identitySource` to accept access tokens."*
  - Change the default to accept either token type (matches OAuth convention).
  - At minimum, surface this prominently in Cognito Authorizer docs — currently it's a footnote.
- **Category**: Authentication / Docs
- **Service(s)**: API Gateway + Cognito User Pool
- **Severity**: medium-high — extremely common gotcha that contradicts OAuth norms; identical error messages for two distinct failure modes make this expensive to diagnose.

### 2026-05-13 — `cdk deploy` IAM Statement Changes table asks for consent that newcomers cannot meaningfully give

- **What I was trying to do**: Run my first `cdk deploy` for the hello-world Lambda + API Gateway stack. CDK paused at the IAM Statement Changes confirmation prompt and asked me to type `y` to confirm before continuing.
- **Friction**: The IAM Statement Changes table was filled with entries like "Allow `lambda:InvokeFunction` on this resource by that principal" — but the table didn't explain what each statement *does*, why it was needed, or which entries (if any) carried non-obvious risk. As a newcomer I had two distinct reactions:
  1. **I couldn't distinguish "standard plumbing" entries from "broader than usual" entries.** Every row looked the same. Was `lambda:InvokeFunction` granted to API Gateway routine and required, or was it overly broad? The table gave no signal either way.
  2. **I was asked to consent without the capability to consent.** The prompt looked like a security checkpoint — "review these IAM changes and approve" — but I didn't have the IAM expertise to evaluate what I was approving. My `y` was effectively "I trust CDK to have generated reasonable defaults." That's not a security review; it's a security ritual.
  This is the worst kind of security UX: a prompt that appears to give the user control but actually requires them to either trust by default or stop everything and become an IAM expert. Most CDK users will type `y` every time because there is no other practical option. The default `--require-approval broadening` setting offers the *illusion* of safety without the substance.
- **What would have been easier**:
  - For each IAM statement in the table, surface a one-line purpose: *"`lambda:InvokeFunction` granted to API Gateway service principal — required for API Gateway to invoke your Lambda. Standard pattern."*
  - Distinguish "standard plumbing" entries (collapsible / dimmed by default) from "broader than usual" entries (highlighted with a warning color and explanation).
  - State the blast radius in plain language: *"If approved, your Lambda becomes invokable from API Gateway. No other access is granted."*
  - For developers who want a deeper review, link out to a CDK-generated explanation page or per-statement docs.
- **Category**: Permissions / Docs
- **Service(s)**: AWS CDK + IAM
- **Severity**: medium-high — foundational UX failure. Every CDK user makes this "consent without comprehension" trade-off; the pattern likely undermines the security goal of the prompt itself. The deepest IAM friction insight from D2.

### 2026-05-13 — CDK's `cfn-exec-role` carries `AdministratorAccess` by default — implicit privilege escalation through `iam:PassRole`

- **What I was trying to do**: Inspect the 5 IAM roles created by `cdk bootstrap` to understand what permissions each one holds.
- **Friction**: One of the roles — `cdk-hnb659fds-cfn-exec-role-<account>-<region>` — has the AWS-managed `AdministratorAccess` policy attached. This means that whenever I run `cdk deploy`, CloudFormation assumes this role and operates with full account-administrator permissions. Every CDK stack deploys with the implicit power to create or modify *any* resource in the account. As a newcomer evaluating a "hello-world Lambda" deployment, the natural question is: "Why does the role doing the deployment have admin access? I'm only deploying a Lambda." The unwritten answer is "CDK doesn't know in advance what services your stacks will touch, so it grants a maximal default." That reasoning is never surfaced. The delegation mechanism that makes this work — `iam:PassRole`, which lets my user hand a high-privilege role to CloudFormation even though my user doesn't directly hold those permissions — is also invisible. The implicit permission chain is: my IdC user (`zzjiang`) → deploy-role (assumed by CDK CLI) → CFN service (which uses `iam:PassRole` to receive cfn-exec-role) → AWS resources. Each hop is necessary; none is explained.
- **What would have been easier**:
  - Bootstrap output: *"⚠️ The `cfn-exec-role` has AdministratorAccess by default. This is maximally permissive for CDK flexibility but exceeds what most stacks need. To scope down, run `cdk bootstrap --cloudformation-execution-policies <policy-arns>`."*
  - A first-time-deploy banner: *"This deploy is being executed by `cfn-exec-role` (full admin) — not by your user directly. This is normal for CDK; here's why: [link to PassRole explainer]."*
  - A diagram in the CDK getting-started docs showing the four-hop trust chain.
- **Category**: Permissions / Docs
- **Service(s)**: AWS CDK + IAM + CloudFormation
- **Severity**: medium-high — security-conscious newcomers notice this and want it explained; most users miss it entirely. The implicit privilege escalation through `iam:PassRole` is one of AWS IAM's most under-explained core mechanics.

### 2026-05-13 — Fresh `cdk init` ships deprecated dependencies and a Node deprecation warning

- **What I was trying to do**: Run `cdk init app --language typescript` to scaffold a new CDK project — my first command-line interaction with CDK as a newcomer.
- **Friction**: The npm install that `cdk init` triggers prints four warnings on a fresh install with current Node (v25.2.1) and current CDK (v2.1121.0):
  1. `(node:81657) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities`
  2. `npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it.`
  3. `npm warn deprecated glob@10.5.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities`
  4. `npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities`
  For a PMT-ES newcomer evaluating AWS tooling quality, this is a poor first impression: AWS's official infrastructure-as-code framework, on its hello-world starter, ships with both a current-Node deprecation warning and three deprecated npm dependencies (one of which the deprecation message literally says *"Do not use it"*). Even if these are transitive deps owned by upstream maintainers, the impression is that CDK isn't keeping its dependency tree healthy. As a newcomer I can't easily tell whether these are safe to ignore or whether I should be worried.
- **What would have been easier**: Either (a) CDK pins fresher transitive dependencies in its starter so a fresh `cdk init` is clean, or (b) the post-init message explicitly addresses the warnings: *"The deprecation warnings above are from upstream dependencies and are tracked in [link]. Safe to ignore."* Silence here forces newcomers to either trust by default or stop and research.
- **Category**: Tooling / Docs
- **Service(s)**: AWS CDK
- **Severity**: low — doesn't block, but the first-impression hit is real, especially for someone evaluating AWS as a PM.

### 2026-05-13 — IAM Identity Center home region: permanent, no warning at creation, and the new multi-region announcement makes it worse

- **What I was trying to do**: Enable IAM Identity Center, ensuring my home region was correctly set to us-west-2.
- **Friction**: The IC enablement screen did not warn that the home region is a permanent choice. To change it later, you must delete the entire IC instance — losing all users, permission sets, and account assignments — and recreate from scratch. The screen treats this irreversible decision the same as any other configuration field. Compounding this: in February 2026, AWS launched IAM Identity Center multi-region replication ([announcement](https://aws.amazon.com/about-aws/whats-new/2026/02/aws-iam-identity-center-multi-region-aws-account-access-and-application-deployment/)). The announcement page reads naturally as "IC now supports multiple regions" — a newcomer doing research before enabling IC could plausibly conclude that region choice is flexible and therefore not careful at enablement time. But the new feature is **replication** to additional regions while the primary region stays fixed; administration still happens in the primary region, and the primary region itself remains non-migratable. The combination — silent at creation + ambiguous announcement — is worse than either issue alone.
- **What would have been easier**: A clear warning on the IC enablement screen: *"The home region is permanent. To change it later you must delete and recreate Identity Center, losing all users and assignments. You can replicate to additional regions afterward, but the primary cannot be changed."* AND a one-line clarification in the multi-region announcement: *"Note: this feature adds additional regions for application access. The primary region selected at IC enablement remains fixed."*
- **Category**: Docs / Tooling
- **Service(s)**: IAM Identity Center
- **Severity**: medium-high — irreversible decision, no UI warning, and a recent product announcement amplifies the misreading risk.

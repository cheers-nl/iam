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

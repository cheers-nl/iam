# Handoff Context — AWS IAM Broker Onboarding Project

> Generated 2026-05-12 by an analysis session that is now ending.
> **Read this file in full before any other action.**
> If you (the new Claude session) are reading this for the first time, your job is to (a) confirm you've absorbed it, (b) help the user execute Day 1, (c) maintain the pain-points log from minute one.

---

## TL;DR

User starts as a **PMT-ES (Product Manager Technical) at AWS IAM on 2026-05-26**, ≈8 working days from this handoff. Manager **Kai** gave a pre-start assignment: build a small app on AWS, document IAM pain points encountered, present them on day 1.

User has near-zero AWS experience (only GUI-configured Lambda once). Plan: build a deliberately small AWS-native demo (**"Team Vault Lite"** — a team password vault) that maximizes IAM friction surface, while keeping scope shippable in 8 days.

Project lives in a **brand new private GitHub repo** (user will pick name, suggested `aws-iam-broker`). **There must be no code or commit-history connection to the user's prior personal project.**

---

## 1. User profile

- **Role**: PMT-ES at AWS IAM, start 2026-05-26
- **Manager**: Kai
- **AWS experience**: GUI-configured a Lambda once; nothing else. Treat as essentially zero — explain everything from first principles. Don't assume familiarity with any service.
- **Tech background**: full-stack capable (TypeScript, Node, Postgres, React). Has previously built a multi-domain personal product (referred to below only as **"the prior project"** — never name it explicitly in artifacts, commits, code, or docs that live in any repo).

---

## 2. The assignment (Kai's direct words, 2026-05-11)

> "use Claude Code or Vercel to build an app on AWS (for example, maybe one of the ideas you heard at business school). See what kind of IAM issues you encounter. Permissions problems, credentials problems, authentication, authorization. If you came prepared on your first day with a list of pain points and suggestions, that would be very impressive."

**Critical interpretive points:**

1. **The deliverable is the pain-points list**, not a finished product. The project is the *vehicle* for surfacing IAM friction, not the end in itself.
2. **"IAM issues" includes friction encountered while building anything on AWS.** IAM is the connective tissue of every AWS service — pain shows up at service-integration moments, not while sitting in the IAM console alone. Lambda↔DynamoDB, Lambda↔KMS, CDK↔anything, Cognito↔Lambda all generate IAM friction. That's the point.
3. **User's near-zero AWS experience is an asset, not a liability** — they will feel pain that experienced users have stopped noticing. Capture every "I had to read 4 doc pages to figure this out" moment.

---

## 3. The selected project: "Team Vault Lite"

A minimal AWS-native team password vault. The functional spec is intentionally tiny: authenticated users can store and retrieve encrypted secrets, with audit logging. Inspiration came from a pattern the user had previously hand-built in their prior project (manual AES-GCM encryption + single env-var key + custom access logging), but **Team Vault Lite is a fresh from-scratch demo with no shared code lineage**.

### Architecture

| Service | Role in app | Primary IAM friction it introduces |
|---|---|---|
| **AWS Identity Center** | Human admin login + CLI auth | Modern setup pain; root vs IAM user vs IC choice; SSO credential resolution chain |
| **CDK** | All infrastructure as code | bootstrap IAM mystery (5 auto-generated roles); `iam:PassRole`; capabilities flags |
| **GitHub Actions OIDC** | CI/CD deploy | Federation trust-policy `sub` claim formatting; the most-loved feature once you understand it |
| **Cognito user pool** | End-user (vault user) login | user pool vs identity pool; ID token vs access token; authorizer types; Cognito groups |
| **Lambda** | API handlers | Execution role vs caller-identity separation |
| **API Gateway** | HTTP front + Cognito authorizer | Authorizer type selection; claim propagation to Lambda; CORS+IAM interaction |
| **DynamoDB** | Encrypted secret storage | Identity-policy scoping; condition keys; per-row authorization patterns |
| **KMS customer-managed key** | Envelope encryption of vault entries | **KMS key policy + IAM identity policy double authorization — the highest-density IAM pain point in all of AWS. Spend a full day here.** |

### Deliberately out of scope (too advanced for 8 days at this experience level)

- ❌ IAM Roles Anywhere (X.509 trust anchor config is a 2-day learning curve on its own)
- ❌ AWS Organizations / multi-account (doubles setup pain for marginal additional coverage)
- ❌ ABAC with session tags (stretch goal only — Day 6 if time)
- ❌ Anything requiring non-AWS third-party services (Stripe, OAuth providers, video, etc.)

---

## 4. The 8-day plan

Each day's goal is **the IAM friction to encounter**, not the features to ship. Friction is the deliverable.

| Day | Build work | Intended IAM friction |
|---|---|---|
| **D1** | Open fresh AWS account; root MFA; enable Identity Center; create admin user; configure CLI with SSO | Account setup; root vs IAM user vs IC; SSO CLI credential chain; first-time billing/MFA UX |
| **D2** | `cdk init`; bootstrap; deploy "hello world" Lambda + API Gateway behind Cognito user pool authorizer | CDK bootstrap's 5 auto-generated IAM roles; `iam:PassRole`; CFN IAM capabilities prompt; first CDK errors |
| **D3** | Build Cognito user pool flow end-to-end; user can sign up + sign in; ID token reaches Lambda | user pool vs identity pool confusion; JWT claim shapes; Cognito "groups" model; authorizer caching surprises |
| **D4** | Lambda writes/reads DynamoDB with caller identity propagated; per-user data isolation via condition keys | First condition-key authoring; `${cognito-identity.amazonaws.com:sub}` or PrincipalTag patterns; row-level security gaps |
| **D5** | Add CMK; switch DynamoDB writes/reads to envelope encryption | **KMS key policy + IAM identity policy double-grant pain** — expect 3–5 distinct pain points just on this day. The biggest learning day. |
| **D6** | ABAC stretch: principal tag from Cognito → DynamoDB row access | Cognito-to-IAM attribute mapping; `sts:TagSession` placement in trust policy; `IfExists` operator semantics |
| **D7** | Run IAM Access Analyzer on stack; deliberately write an over-permissive policy to see if it flags | Access Analyzer findings quality; UX of policy checks; unused-access analyzer experience |
| **D8** | **Stop building.** Organize pain log into categorized list + suggestions doc | (no new build) |

**Hard discipline**: at end of D7, regardless of completion state, **stop development and switch to documentation**. Kai wants the list, not a working demo. A 60%-complete demo with a thorough pain log beats a 100%-complete demo with sketchy notes.

---

## 5. Critical operational rules

### Naming and references

- **Never reference the prior personal project by name** in: commit messages, code comments, READMEs, repo names, or any artifact that lives in any git tree (even private). Use "the prior project" or "a prior personal project" if reference is unavoidable.
- When inspiration from the prior project shapes a design decision, write it as: *"From an earlier project I learned X"* — generic phrasing.
- If user requests direct code citations or detailed analysis of the prior project, **defer to `~/Documents/aws-iam-onboarding/stellen-reference-analysis.md`** (see §7 — currently NOT generated, awaiting lawyer clearance).

### Git operations

- **All broker commits go to the new `aws-iam-broker` private repo only.** Never to any other remote.
- **Never use any git identity tied to the prior project for broker commits.** First time you enter the broker directory, verify:
  ```bash
  git config user.email   # should be user's personal email, not prior-project email
  git config user.name    # should be user's personal name
  ```
- If user is in an "analysis iteration" session at `~/Downloads/Git/stellen-analysis-readonly/`, that session's role is **read-only on prior code, write-only on `~/Documents/aws-iam-onboarding/`**. Never commit there. Never push.

### Pushing

- The user's local `~/Downloads/Git/stellenapp/` clone has `origin` pointing to the prior-project production repo. **Never open a Claude session in that directory.** If user accidentally cd's there, redirect.
- The user's `~/Downloads/Git/stellen-analysis-readonly/` clone (if created) points to an *archived* private fork; pushes will be rejected by GitHub server-side. Even so, never attempt push.

---

## 6. Lawyer dependency — important

User was strongly advised to consult an **immigration attorney** about their overall posture (the relationship between prior contributions to the prior project and the new AWS employment, given their work-authorization situation). At time of this handoff, **lawyer status is NOT CONFIRMED.**

Implications:

- The file `~/Documents/aws-iam-onboarding/stellen-reference-analysis.md` (deep code-level pattern analysis of the prior project) **has NOT been generated**. Decision: do not generate until user explicitly confirms lawyer has cleared this kind of work.
- If user requests detailed code-level critique referencing the prior project during your session, ask: *"Has the lawyer signed off on this analytical work?"* If no, defer.
- First-day deck content drawn from the prior project should remain **generic patterns**, not specific code citations, until lawyer clears.

---

## 7. Directory architecture

```
~/Downloads/Git/stellenapp/                   ← OLD local copy of prior project
   └── DO NOT open Claude sessions here.
       origin points to prior-project production remote.
       Leave untouched until lawyer guidance.

~/Downloads/Git/stellen-analysis-readonly/    ← User MAY clone their archived private fork here
   ├── origin → archived private fork (pushes blocked at GitHub server)
   └── Purpose: future analysis iteration sessions ONLY.
       Read-only mental model. Never commit, never push.
       (Status: not created yet at handoff time.)

~/Downloads/Git/aws-iam-broker/               ← THIS broker project's working directory
   ├── origin → new private repo (aws-iam-broker on user's personal GitHub)
   └── Purpose: ALL broker code, commits, pushes.
       This is where Claude broker sessions run.

~/Documents/aws-iam-onboarding/               ← In NO git tree, outside any repo
   ├── handoff-context.md                     (THIS file)
   └── stellen-reference-analysis.md          (DEFERRED — awaiting lawyer clearance)
```

---

## 8. Session-type protocol

Three distinct Claude Code session types exist. **Do not mix them.**

| Type | Working directory | Reads | Writes | Pushes to |
|---|---|---|---|---|
| **A. Broker build** | `~/Downloads/Git/aws-iam-broker/` | broker code + handoff doc | broker code | new `aws-iam-broker` repo only |
| **B. Analysis iteration** | `~/Downloads/Git/stellen-analysis-readonly/` | prior-project code (read-only) + analysis doc | `~/Documents/aws-iam-onboarding/stellen-reference-analysis.md` only | never pushes |
| **C. Original handoff-generation session** | (was in prior-project worktree) | — | this file you're reading | did not push |

This session you're reading this in should be **type A — Broker build**.

---

## 9. What to do FIRST in this new session

1. **Confirm to user**: state out loud that you've read the handoff and you understand: (a) the project, (b) the deliverable, (c) the constraints, (d) the legal isolation rules.
2. **Ask user about lawyer status.** This decides whether `stellen-reference-analysis.md` ever gets generated.
3. **Verify environment**:
   ```bash
   pwd                        # should be ~/Downloads/Git/aws-iam-broker
   git remote -v              # should show aws-iam-broker remote only
   git config user.email      # should be personal email
   ```
4. **Create the pain log file** in the broker repo as the very first commit:
   ```bash
   touch pain-log.md
   git add pain-log.md
   git commit -m "Initialize pain log"
   ```
5. **Start Day 1**: walk user through opening a fresh AWS account, root MFA, Identity Center enablement, admin user creation, CLI configuration with SSO. **Log every friction point.**

---

## 10. Pain-log format

Use this format for every friction entry:

```markdown
## Day N — [Topic]

### YYYY-MM-DD HH:MM — [Short title]
- **What I was trying to do**: [1 line]
- **Friction**: [1–3 lines describing what blocked or confused me]
- **What would have been easier**: [1 line — the PM suggestion]
- **Category**: [Permissions / Credentials / Authentication / Authorization / Tooling / Docs]
- **Service(s)**: [e.g., Cognito + Lambda + API Gateway]
- **Severity**: [low / medium / high — gut feel]
```

At Day 8, group entries by category and summarize the top 5–10 themes. That summary is what gets presented to Kai on Day 1.

---

## 11. Open items at handoff time

| Item | Status | Blocks |
|---|---|---|
| Immigration lawyer consultation | NOT CONFIRMED | Generation of `stellen-reference-analysis.md`; depth of first-day deck content from prior project |
| AWS account creation | Not done | Day 1 work |
| New `aws-iam-broker` private repo (or similar name) | Not done | All broker workflow |
| Archive of prior private fork on GitHub | Not done | Extra safety layer for isolation |
| Local clone to `~/Downloads/Git/stellen-analysis-readonly/` | Not done | Future analysis iteration sessions |
| Pain-log file initialized in broker repo | Not done | All friction capture |

---

## 12. Pre-flight checklist before Day 1

User should complete these *in order* before starting actual AWS work:

- [ ] **Lawyer consultation scheduled** (strongly recommended before *any* new work)
- [ ] Prior private fork archived on GitHub (extra physical lock against accidental push)
- [ ] New `aws-iam-broker` (or chosen name) empty private repo created on GitHub
- [ ] Local directory initialized:
  ```bash
  mkdir -p ~/Downloads/Git/aws-iam-broker
  cd ~/Downloads/Git/aws-iam-broker
  git init
  git remote add origin git@github.com:<user>/aws-iam-broker.git
  git config user.email "<personal email>"
  git config user.name "<personal name>"
  ```
- [ ] (Optional) Local clone of archived fork for future analysis sessions:
  ```bash
  cd ~/Downloads/Git
  git clone git@github.com:<user>/<archived-fork-name>.git stellen-analysis-readonly
  cd stellen-analysis-readonly
  git remote set-url --push origin no-push   # third layer of safety
  ```
- [ ] New AWS account opened, root password set, root MFA enabled (FIDO2 preferred)
- [ ] Billing alarm configured on new AWS account
- [ ] This new Claude session opened in `~/Downloads/Git/aws-iam-broker/`

---

## 13. Decision history (for context — why this project, not others)

Six options were considered:

1. **Rebuild prior project's `GroupSecret` feature on AWS** — small, clean mapping, but a niche feature of an Events sub-system; weak first-day narrative.
2. **Rebuild a core prior-project offering (Coaching booking, Events checkout, Services flow)** — strong narrative but heavily entangled with third-party SaaS (Stripe, Daily.co, SendGrid, OAuth providers); 80 % of time would be non-AWS work.
3. **Brand new B-school idea** — fresh start, but requires product decisions that eat into IAM-friction time; loses the "real product builder" credibility from prior project.
4. **Brand new + use prior project as analytical reference** — better, but separate-but-thin risk.
5. **Full migration of prior project's backend to AWS** — strongest narrative, completely unrealistic in 8 days for a beginner; high probability of "half done, can't talk about it."
6. **Partial migration of one prior-project route family** — mid-risk; non-IAM friction (DB migration, OAuth re-wiring) dilutes IAM focus.

**Chosen: a hybrid of 4 + a specific instance of 3.** The fresh demo (Team Vault Lite) provides the live first-customer experience; the prior project serves as analytical reference (in `~/Documents/`, pending lawyer). The fresh project's design is *inspired by* a pattern from the prior project (manual secret encryption) but written from scratch with zero code lineage.

The choice was specifically calibrated for: (a) the 8-working-day budget, (b) the user's near-zero AWS experience, (c) maximizing IAM-friction density per hour, (d) maintaining a coherent first-day narrative.

---

**End of handoff.**

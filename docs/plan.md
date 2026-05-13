# Team Vault Lite — Implementation Plan

> Generated 2026-05-13. Living document — update as decisions evolve.
> Companion to `~/Documents/aws-iam-onboarding/handoff-context.md` (authoritative spec) and `~/Documents/aws-iam-onboarding/stellen-reference-analysis.md` (design reference).

---

## What this project is

A small AWS-native team password vault built as a vehicle for surfacing IAM friction during pre-start onboarding. The deliverable to Kai on **2026-05-26** is a **6-pager narrative document** (Amazon style — no decks) plus a **working web UI demo**. The build is the means; the pain log is the end.

---

## Timeline

| Date | Phase |
|---|---|
| 2026-05-13 (today) | Pre-flight + repo scaffold |
| 2026-05-14 → 2026-05-21 | Build (D1 → D8) |
| 2026-05-22 → 2026-05-25 | Buffer: refine doc, rehearse demo, rest |
| 2026-05-26 | Day 1 at AWS — present to Kai |

8 build days, then 4 days of buffer before Day 1 — meaningful margin if any day overruns.

---

## Pre-flight checklist (today, ~30 min)

- [x] Lawyer cleared analytical work referencing the prior project (2026-05-12)
- [x] Prior private fork archived on GitHub
- [x] New private repo `cheers-nl/iam` created and confirmed private
- [x] Local directory initialized at `~/Downloads/iam/`, personal git identity verified
- [x] Claude session running in build directory
- [ ] First commit: `pain-log.md`, `.gitignore`, `README.md`, `docs/` scaffold
- [ ] (Optional) `brew install gh` for repo verification by command going forward

---

## 8-day build plan

Each day's primary goal is the **IAM friction encountered**, not the features shipped. Features are vehicles for friction.

### D1 — AWS account + Identity Center

**Build:** Open fresh AWS account; root MFA (FIDO2 preferred); billing alarm; enable Identity Center; create admin user/group; configure local CLI with `aws sso login`.
**Friction targets:** root vs IAM user vs Identity Center mental model; SSO credential resolution chain; first-time billing/MFA UX; profile management in `~/.aws/config`.
**Done when:** `aws sts get-caller-identity` returns your SSO admin identity.

### D2 — CDK bootstrap + hello-world Lambda

**Build:** `cdk init`; `cdk bootstrap`; deploy a Lambda + API Gateway returning `{ "ok": true }`.
**Friction targets:** CDK's 5 auto-generated bootstrap roles; `iam:PassRole`; CFN IAM capabilities prompt; first time reading a CDK deploy error trace.
**Done when:** `curl <api-gw-url>/hello` returns 200 from your Lambda.

### D3 — Cognito user pool + ID token flow

**Build:** Cognito user pool with email signup; **Cognito Hosted UI** enabled (saves frontend code, surfaces more AWS-side wiring); ID token validates at API Gateway via Cognito authorizer.
**Friction targets:** User pool vs identity pool confusion; ID token vs access token (which does API Gateway accept?); authorizer caching; Hosted UI domain + app client callback URL configuration.
**Done when:** Authenticated `curl` with a Cognito JWT returns 200; unauthenticated returns 401.

### D4 — Lambda + DynamoDB scoped writes

**Build:** Lambda writes/reads DynamoDB scoped by `sub` (Cognito user ID) propagated through API Gateway claims.
**Friction targets:** First condition-key authoring; `${cognito-identity.amazonaws.com:sub}` vs PrincipalTag patterns; row-level isolation; how claim shape reaches Lambda event.
**Done when:** User A cannot read User B's vault entries — verified by switching tokens.

### D5 — KMS CMK + envelope encryption (the big day)

**Build:** Create customer-managed KMS key; Lambda uses `GenerateDataKey` on write, `Decrypt` on read; encrypted blob + encrypted DEK stored in DynamoDB.
**Friction targets:** **Key policy ↔ identity policy double-grant** — the single highest-density IAM pain point. Expect 3–5 distinct entries just on D5.
**Done when:** End-to-end encrypted write + decrypt round-trip works through the deployed API.

### D6 — Web UI on S3 + CloudFront

**Build:** Minimal Vite + React SPA. Login via Cognito Hosted UI redirect flow. Pages: list secrets, create secret, reveal secret. Hosted on S3 with **CloudFront Origin Access Control (OAC)** in front; S3 bucket policy locks access to CloudFront only.
**Friction targets:** OAC vs legacy OAI (modern best practice, poorly documented); S3 bucket policy + Block Public Access interaction; Cognito app client callback URLs and allowed origins; CORS pre-flight on API Gateway from the CloudFront origin; how CloudFront serves an SPA's `index.html` for client-side routes.
**Done when:** Open the CloudFront URL in a browser → log in → create + reveal a secret end-to-end.

**Tradeoff noted:** D6 was originally an ABAC stretch (Cognito groups → principal tag → DynamoDB row filter). Replaced with web UI since demo is now required for the Day 1 deliverable. ABAC moves to "future work" mention in the 6-pager.

### D7 — IAM Access Analyzer + intentional over-permissive policy

**Build:** Morning: run IAM Access Analyzer on the stack; deliberately write an over-permissive policy and observe whether AA flags it. Afternoon: web UI polish + end-to-end smoke test of the full flow (signup → create → reveal → audit).
**Friction targets:** Access Analyzer findings quality; unused-access analyzer UX; what gets flagged vs missed; how findings surface in the console.
**Done when:** Pain log has a concrete "what AA caught vs missed" entry; demo runs cleanly cold from a fresh browser session.

### D8 — Stop building. Write the 6-pager.

**Build:** Nothing. **Hard stop on code.**
**Output:** `docs/deliverable-6pager.md` — Amazon narrative format. Pain log moves to an appendix at the end.
**Done when:** 6-pager exists, draft is readable cold (you can hand it to someone with no context and they'll follow it).

**Discipline reminder:** Per handoff §4 — at end of D7, regardless of completion state, stop development and switch to documentation. 60% demo + thorough doc beats 100% demo + sketchy notes.

---

## Buffer phase (2026-05-22 → 2026-05-25)

| Day | Activity |
|---|---|
| +1 (05-22) | Read 6-pager cold the next morning. Rewrite anything mushy. |
| +2 (05-23) | Practice the demo cold from a fresh browser. Two run-throughs, 15 min each. |
| +3 (05-24) | Re-read pain log appendix; trim entries that have gone stale; tighten the top-3 themes. |
| +4 (05-25) | Rest. No code, no edits. |

No new IAM work or pain log entries in this phase. Refinement only.

---

## 2026-05-26 — Day 1 at AWS with Kai

- Hand Kai the 6-pager; he reads silently (Amazon standard ~20 min)
- Discussion: walk through top 3 pain themes in depth
- Demo: open CloudFront URL, run through the full flow live if he asks
- Honest "I haven't dug into that yet" answers on unfamiliar questions are credible; posturing is not

---

## Architecture (services in use)

| Service | Role | Primary IAM friction surface |
|---|---|---|
| AWS Identity Center | Human admin login + CLI auth | Root vs IAM user vs IC; SSO credential chain |
| CDK | Infrastructure as code | Bootstrap roles; `iam:PassRole`; capabilities flags |
| GitHub Actions OIDC | CI/CD deploy | Federation trust policy `sub` claim formatting |
| Cognito user pool + Hosted UI | End-user auth | User pool vs identity pool; token types; Hosted UI config |
| Lambda | API handlers | Execution role; caller identity propagation |
| API Gateway | HTTP front + Cognito authorizer | Authorizer types; claim propagation; CORS |
| DynamoDB | Encrypted secret storage | Identity-policy scoping; condition keys |
| KMS customer-managed key | Envelope encryption | **Key policy + identity policy double grant** |
| S3 + CloudFront | Web UI hosting | OAC config; bucket policy; SPA routing |
| IAM Access Analyzer | Policy review | Findings UX; what's caught vs missed |

---

## Decisions log

| Decision | Choice | Rationale |
|---|---|---|
| Build location | `~/Downloads/iam/` (not handoff's suggested `~/Downloads/Git/aws-iam-broker/`) | All isolation properties satisfied (personal identity, fresh git, generic name); path string was not load-bearing |
| Build vs migrate | Build fresh, not modify stellen fork | Pain log signal clarity; lawyer-cleared analysis ≠ derivative work; cleaner Day 1 narrative |
| Day 1 artifact format | 6-pager narrative doc, no decks | Amazon culture forbids decks; narrative is more PMT-ES appropriate |
| Demo option | Web UI (S3 + CloudFront + Cognito Hosted UI) | Selected for demo-ability; adds genuine IAM friction (OAC, bucket policy, CORS) |
| Demo timing | Built D6 as one-shot, polished D7 PM | Web UI is hard to split incrementally; needs concentrated effort |
| ABAC (session tags) | Dropped from active scope | Replaced by web UI in D6; mentioned as future work in 6-pager |
| Cognito UI strategy | Hosted UI, not custom login form | Less frontend code; more AWS-side wiring to learn (which surfaces more friction) |
| Doc length | 6-pager (not 2-pager) | Substance to fit; Kai having longer-form gives more discussion surface |
| Frontend stack | Vite + React | User has React experience; minimal modern toolchain |
| CI/CD identity | GitHub Actions OIDC, no static AWS access keys anywhere | Modern best practice; replaces the static-keys pattern user has been using |

---

## Pain log discipline (reminder)

1. **Capture entries when the pain happens**, not at end of day. End-of-day reconstruction loses texture.
2. **Use the §10 format every time**: title, what I was trying to do, friction, what would've been easier, category, services, severity.
3. **If stuck >20 min**, it's an entry. Don't filter.
4. **Notice gaps**: if Docs category has no entries by D5, something's wrong (you've been avoiding docs).
5. **Predicted ≠ encountered**: pain points predicted in the reference analysis only land in the log if you actually hit them. Don't backfill.
6. **Encountered ≠ predicted**: un-predicted pain points are the highest-value entries — they expand the known map.

---

## Reference paths

- Handoff doc (authoritative spec): `~/Documents/aws-iam-onboarding/handoff-context.md`
- Prior-project reference analysis: `~/Documents/aws-iam-onboarding/stellen-reference-analysis.md`
- Prior project source (read-only): `~/Downloads/Git/stellenapp/`
- This plan: `docs/plan.md` (in repo)
- Pain log: `pain-log.md` (in repo, root)
- Day 1 deliverable: `docs/deliverable-6pager.md` (created on D8)

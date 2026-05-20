# Stellen Reference Analysis — IAM-Relevant Patterns

> Generated 2026-05-12. Lawyer clearance: **confirmed by user in handoff-execution session, 2026-05-12.**
> Companion to `handoff-context.md` (§6).
> Lives outside any git tree by design. **Do not commit. Do not push. Do not copy into the broker repo.**

---

## 0. How to use this document

This is the analytical reference referenced in §6 of the handoff doc. The broker session at `~/Downloads/Git/aws-iam-broker/` should:

- Read this when designing Team Vault Lite components that mirror prior-project patterns.
- Use the §4 mapping table as the spine of Team Vault Lite's architecture decisions.
- Use the §6 seed list as a watchlist — friction must be experienced, not preloaded.
- Cite generically in any pain-log entry: *"From an earlier project I learned X"* — never reference the prior project by name in artifacts that land in the broker repo (per handoff §5).

**Context the handoff doc missed**: Kai's pre-start assignment is actually **two phases**. Phase 1 is studying the 7 IAM tutorials at https://docs.aws.amazon.com/IAM/latest/UserGuide/tutorials.html (cross-account roles, customer-managed policies, ABAC, MFA self-mgmt, 3× SAML/CFN). Phase 2 is the Team Vault Lite build described in the handoff. The pain log spans **both** — tutorial friction and build friction both count, and the *most valuable* entries are at the seam between them ("the tutorial said X, but in practice Y"). §6 below flags which build days have a tutorial precedent.

This document does **not** authorize copying code. Patterns are described; code is quoted only as enough evidence to identify the pattern. Team Vault Lite is to be written from scratch with zero shared lineage.

---

## 1. TL;DR — what to take forward

The prior project's **GroupSecret** feature is the most direct inspiration for Team Vault Lite. It implements:

- Envelope-style encryption (AES-256-GCM) of a value-at-rest in Postgres.
- A **single env-var-held** 32-byte symmetric key (`GROUP_SECRET_KEY`).
- A `GroupSecretAccessLog` table that records every reveal action.
- A three-layer authorization stack (JWT auth middleware → role-check middleware → query-level tenant scoping).

Team Vault Lite is the AWS-native re-implementation of that pattern. The §3 mapping table is the spine of the design — each row is one architectural decision the broker session will make and one cluster of IAM friction it will surface.

---

## 2. The GroupSecret pattern (deep dive)

### 2.1 Data model

[`backend/prisma/schema.prisma:414–451`]

```prisma
model GroupSecret {
  id               String   @id @default(cuid())
  groupId          String
  title            String
  category         GroupSecretCategory @default(GENERAL)
  loginUrl         String?
  usernameHint     String?
  accountOwnerNote String?
  recoveryNote     String?
  lastVerifiedAt   DateTime?
  encryptedValue   String
  iv               String
  authTag          String
  algorithm        String   @default("aes-256-gcm")
  keyVersion       Int      @default(1)
  createdById      String
  // ...
}

model GroupSecretAccessLog {
  id            String   @id @default(cuid())
  groupSecretId String
  viewerUserId  String
  action        String   @default("REVEAL")
  createdAt     DateTime @default(now())
}
```

Observations:

- `iv` and `authTag` stored separately as base64 text columns — three columns per row.
- `algorithm` stored per row — supports future cryptographic agility; never actually varies.
- `keyVersion` field exists but is **never incremented** in code. No rotation implementation.
- Access log captures REVEAL only — not create, update, delete, list-metadata, or permission denials.
- Index design: `(groupSecretId, createdAt)` and `(viewerUserId, createdAt)` on the log — supports per-secret and per-user audit queries.

### 2.2 Encryption module

[`backend/utils/groupSecretCrypto.js`] — 67 lines total.

```js
function getSecretKey() {
  const raw = String(process.env.GROUP_SECRET_KEY || "").trim();
  if (!raw) throw new Error("GROUP_SECRET_KEY is not configured");
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("GROUP_SECRET_KEY must decode to 32 bytes");
  return key;
}

function encryptSecretValue(plainText) {
  const key = getSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText || ""), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    algorithm: "aes-256-gcm",
    keyVersion: 1,
  };
}
```

Critical properties:

- **Key source**: one env var. No HSM, no KMS, no Secrets Manager. Lives in process memory and (operationally) in `.env` / Vercel env config.
- **Encoding flexibility**: accepts hex (64-char) or base64; must decode to exactly 32 bytes. Defensive parsing.
- **Algorithm**: AES-256-GCM with fresh 12-byte IV per encryption (correct — never reused with the same key).
- **No KMS round-trip**: pure Node `crypto`. Zero network calls; zero auditability beyond the application's own log table.
- **Failure mode**: throws on missing/malformed key. Caller (route handler) must catch; otherwise 500.

### 2.3 Reveal flow with audit

[`backend/routes/groupAccount.js:2363–2410`]

```js
router.post(
  "/:groupId/secrets/:secretId/reveal",
  authGuard,             // [1] JWT validation
  requireGroupAdmin,     // [2] role check (group ADMIN)
  async (req, res, next) => {
    const secret = await prisma.groupSecret.findFirst({
      where: { id: secretId, groupId },   // [3] tenant scope in query
      select: { /* iv, authTag, encryptedValue, ... */ },
    });
    if (!secret) return res.status(404).json({ ok: false, error: "Secret not found" });

    const plainValue = decryptSecretValue(secret);

    await prisma.groupSecretAccessLog.create({
      data: { groupSecretId: secret.id, viewerUserId: req.user.id, action: "REVEAL" },
    });

    return res.json({ ok: true, revealedValue: plainValue });
  }
);
```

The three-layer defense:

1. **`authGuard`** — parses Bearer token from `Authorization` header or `req.cookies.token`, verifies JWT signature with `process.env.JWT_SECRET`, attaches `req.user`. [`backend/middleware/auth.js:10–28`]
2. **`requireGroupAdmin`** — wraps `assertGroupAdmin(userId, groupId)`, which checks `GroupMember.role === "ADMIN"`. [`backend/middleware/permission.js:22–30`]
3. **Query-level scoping** — `findFirst({ where: { id, groupId } })` ensures even if (2) is bypassed (e.g., role-check bug, stale cache), the secret must belong to the asserted group. Defense in depth.

**Race window**: audit log write is non-transactional with the decrypt. If the request fails between `decryptSecretValue` and `prisma.groupSecretAccessLog.create`, the value was returned to the caller but never logged. Not a vulnerability per se — but a gap a CloudTrail-based audit would close automatically.

---

## 3. Other security-adjacent patterns

### 3.1 OAuth token encryption (secondary vault pattern)

[`backend/utils/secretBox.js`] — 89 lines.

A **second, parallel encryption module** for Calendly OAuth tokens at rest. Same algorithm (AES-256-GCM, 12-byte IV), but differences worth noting:

- **Key derivation**: SHA-256 of a string secret, not a raw 32-byte buffer. `crypto.createHash("sha256").update(secret).digest()`.
- **Dev fallback to JWT_SECRET** (lines 7–18):
  ```js
  if ((process.env.NODE_ENV || "development") !== "production") {
    return String(process.env.JWT_SECRET || "").trim();
  }
  ```
  In non-prod, the **same secret signs JWTs and encrypts OAuth tokens at rest.** Compromise of JWT_SECRET = compromise of both. Security antipattern — see §5.1.
- **Versioned ciphertext format**: `v1.<iv>.<authTag>.<ciphertext>` — single dot-separated string column rather than four columns. Backward-compat: returns raw string unchanged if it doesn't start with `v1.`.

**Pattern note**: two encryption modules with overlapping responsibilities co-exist in the same backend. One uses raw-key column-per-field; the other uses derived-key single-field versioned. A unified envelope module would have been cleaner.

### 3.2 Authentication

[`backend/middleware/auth.js`, `backend/utils/jwt.js`]

- Stateless JWT, no server-side session store.
- Token sources accepted: `Authorization: Bearer ...` header **or** `req.cookies.token` (cookie fallback).
- JWT secret: `process.env.JWT_SECRET`. One secret signs every token issued.
- Default token TTL: 7 days (`process.env.JWT_EXPIRES || "7d"`).
- No refresh-token rotation; no revocation list.
- Mobile uses `expo-secure-store` (platform Keychain/Keystore) for token persistence; web uses `localStorage`. [`mobile/src/api/client.ts:8–31`, `frontend/src/api.ts:760–793`]
- Login flow: Passport Google OAuth2 strategy in `backend/index.js:273–299`; email/password with bcrypt-10 hashing in `backend/index.js:2570, 2688`.

### 3.3 Authorization

[`backend/middleware/permission.js`]

Three helpers, all **imperative** (function calls inside route handlers, throw on failure):

- `assertEventOwner(req, eventId)` — host-only.
- `assertGroupAdmin(userId, groupId)` — checks GroupMember.role === "ADMIN". **Self-admin special case** (`if (userId === groupId) return true`) for solo group accounts where the user IS the group.
- `assertEventOwnerOrGroupAdmin(req, eventId)` — multi-path: system admin → host → co-host (`coHostUserIds` array contains check) → group admin. Fallback that infers `groupId` from a GROUP-kind user record if `event.groupId` is null.

**Pattern**: authorization is computed *per request, in JavaScript, by reading the entity and running a check function*. There is no declarative policy language. Each protected route reads its target entity twice (once for the auth check, once for the actual operation, unless the dev manually deduplicates).

### 3.4 Audit logging

**Only one access log model exists** (`GroupSecretAccessLog`), and it tracks only the REVEAL action on group secrets. Not logged anywhere in the database:

- Secret creation, update, deletion.
- Listing of secret metadata.
- Authentication events (login success, failure, lockout).
- Permission denials (403s).
- Token issuance / refresh.
- Sensitive admin actions outside the GroupSecret feature.

Implicit logging (Express `console.log`, request middleware) exists but is non-queryable and non-tamper-evident.

### 3.5 Third-party credential handling

Every third-party API key is `process.env.*`. No centralized retrieval; no vault integration; no rotation. Each module reads its env vars at module-load time.

| Service           | Env vars                                                         | Source file                        |
|-------------------|------------------------------------------------------------------|------------------------------------|
| Stripe            | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                     | `backend/utils/coachingCheckout.js:20–25`, `backend/routes/stripe.js:23–40` |
| SendGrid          | `SENDGRID_API_KEY`, `SENDGRID_FROM`                              | `backend/utils/mailer.js:10–11`    |
| Daily.co          | `DAILY_API_KEY`                                                  | `backend/utils/daily.js:12`        |
| Twilio            | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `TWILIO_MESSAGING_SERVICE_SID` | `backend/utils/smsVerify.js:5–9`   |
| Google OAuth      | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`| `backend/index.js:112–132, 273–299`|
| Outlook OAuth     | `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`                     | `backend/index.js:112–132`         |
| Calendly OAuth    | `CALENDLY_CLIENT_SECRET`, `CALENDLY_TOKEN_ENCRYPTION_SECRET`     | `backend/index.js:112–132`, `backend/utils/secretBox.js:7–18` |
| AWS S3            | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`       | `backend/s3.js`, `backend/index.js:137–141`, `backend/routes/events.js:32–35` |
| Agent runtime     | `STELLEN_PLATFORM_PRIVATE_KEY`, `STELLEN_PLATFORM_PUBLIC_JWK_X` (Ed25519) | `agent-runtime/src/platform/auth.ts` |

### 3.6 AWS S3 usage — the only existing AWS surface

[`backend/s3.js`, `backend/index.js:137–141`, `backend/routes/events.js:32–35`]

```js
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
```

Three separate `new AWS.S3({...credentials})` initializations across files — none share a client; each reads env vars independently. All use AWS SDK v2 (now in maintenance). ACL on uploaded objects: `public-read`. Object keys prefixed `/avatars/` or `/event-covers/`.

This is **the only production AWS surface area in the entire prior project** — a long-lived IAM user's static access keys, granting blanket S3 PutObject on a single bucket. The user's AWS exposure to date is approximately this client and the Lambda one-off referenced in the handoff. Team Vault Lite will eliminate static access keys entirely.

### 3.7 Webhook signature verification

[`backend/routes/stripe.js:23–40`, `backend/index.js:221–229`]

Stripe webhooks: `express.raw({ type: "application/json" })` mounted on `/api/stripe/webhook` *before* any JSON parser, then `stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)`. Textbook pattern. No equivalent verification for any other inbound provider — but no other provider sends signed webhooks here either.

### 3.8 CORS and (missing) rate limiting

[`backend/index.js:207–219`]

```js
const allowlist = [
  FRONTEND_URL,
  "http://localhost:5173",
  "https://stellen-platform.vercel.app",
  "https://stellenapp.com",
  "http://stellenapp.com",
];
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowlist.includes(origin)),
  credentials: true,
}));
```

- CORS: hardcoded 5-origin allowlist. Changing requires redeploy. No CSRF tokens; relies on Authorization header + same-origin.
- **No rate limiting** anywhere in the request pipeline. Login, password reset, signup, OAuth callback, secret reveal — all unthrottled at the app layer. (Vercel/Cloudflare may provide platform-level throttling, but it's not in the app.)

---

## 4. Pattern → AWS IAM mapping (the design spine for Team Vault Lite)

For each prior-project pattern, this table maps to the AWS-native equivalent the broker will build, and predicts the IAM friction the migration will surface.

| Prior pattern | AWS-native equivalent | IAM friction to expect |
|---|---|---|
| `GROUP_SECRET_KEY` env var (single symmetric key in process memory) | KMS customer-managed key (CMK), envelope encryption | **Key policy ↔ identity policy double-grant.** Whoever holds the data must also be granted on the key. The single highest-density pain point in all of AWS (per handoff §3). |
| `encryptSecretValue()` Node crypto call | `KMS.GenerateDataKey` — CMK encrypts a data key; plaintext data key used in Lambda memory only, encrypted data key stored alongside ciphertext | `kms:GenerateDataKey` is a *separate permission* from `kms:Decrypt`. Granting one without the other = half-broken. |
| `decryptSecretValue()` Node crypto call | `KMS.Decrypt` + GCM auth tag verification in Lambda | Caller identity (Lambda execution role) must be on key policy AND identity policy. |
| `JWT_SECRET` env var | Cognito user pool issuer + API Gateway Cognito authorizer (JWKS-fetched verification) | Authorizer type choice (Cognito vs Lambda authorizer vs IAM authorizer); ID token vs access token semantics. |
| Bearer token in `Authorization` header | Cognito-issued JWT in `Authorization` header → API Gateway Cognito authorizer | Claim propagation from authorizer to Lambda `event.requestContext.authorizer.claims`; authorizer 5-min default cache. |
| `authGuard` middleware | API Gateway Cognito authorizer (declarative replacement) | Loss of fine control: cookie fallback gone; CORS preflight bypasses authorizer (OPTIONS unauthenticated). |
| `requireGroupAdmin` middleware (imperative) | Cognito group → IAM principal tag → DynamoDB condition keys (declarative) | Cognito-to-IAM attribute mapping requires *identity pool* (not user pool); `sts:TagSession` placement; `IfExists` operator semantics. |
| Per-tenant `where: { id, groupId }` query scoping | DynamoDB condition keys on `${aws:PrincipalTag/groupId}` matching partition key | Row-level authorization pattern; depends entirely on the principal tag being trustworthy. |
| `GroupSecretAccessLog` table | CloudTrail data events for `kms:Decrypt` (automatic, tamper-evident) + DynamoDB Streams → Lambda → audit table | CloudTrail event payload shape; data-event volume + cost; "where do I see the log" first-time UX. |
| `ACL: "public-read"` on S3 uploads | S3 private bucket + signed URLs OR bucket policy with explicit principal grants; **Block Public Access on by default** | The S3 access model has *four overlapping layers*: account-level BPA, bucket-level BPA, bucket policy, ACL. The most-confusing access model in AWS. |
| Hardcoded CORS allowlist | API Gateway CORS config + Cognito app client's allowed callback/logout URL list | CORS + Cognito hosted UI interaction; preflight OPTIONS auth bypass means CORS != auth. |
| AWS IAM user static access keys for S3 | **Eliminate.** GitHub Actions OIDC → assume role (deploys); Lambda execution role (runtime); Identity Center SSO (humans) | Trust policy `sub` claim formatting for OIDC — fiddly the first time, "most-loved feature" per handoff §3 once understood. |
| Stripe webhook signature verification | (not migrated — Team Vault Lite has no external webhooks) | n/a |
| No rate limiting | Out of scope for Team Vault Lite. (Production answer: API Gateway usage plans + WAF + Cognito advanced security.) | n/a |

---

## 5. Antipatterns to NOT carry forward

### 5.1 Dev fallback to `JWT_SECRET` for encryption-at-rest

[`backend/utils/secretBox.js:7–18`]

In non-prod, the JWT signing secret is reused as the OAuth token encryption secret. One key, two purposes — a textbook key-reuse antipattern. In Team Vault Lite, KMS makes this impossible by construction (signing and encryption use distinct key types and key IDs).

### 5.2 `keyVersion` field with no implementation

[`backend/prisma/schema.prisma:428`] — `keyVersion Int @default(1)` exists on every secret row, but `getSecretKey()` knows nothing about versions. Every row is `keyVersion = 1`. **Rotation was thought about and not implemented.** AWS replacement: KMS automatic annual rotation under the hood + a `key-id` column on the secret row to support reading old ciphertexts during migration. (Out of scope for 8-day plan; worth one pain log entry: *"how does KMS rotation interact with my stored ciphertexts?"*)

### 5.3 Long-lived AWS access keys in env vars

[`backend/s3.js`, `backend/index.js:137–141`, `backend/routes/events.js:32–35`] — `AWS_SECRET_ACCESS_KEY` in env, read by three separate clients. Replace with:

- **Humans**: AWS Identity Center SSO (`aws configure sso`).
- **CI/CD**: GitHub Actions OIDC → assume role (short-lived STS creds).
- **Lambda**: execution role (no creds at all — SDK reads from instance metadata).

**`AWS_SECRET_ACCESS_KEY` should never appear in Team Vault Lite's `.env`.** If it does, you have a deeper modeling problem to log.

### 5.4 Imperative authorization scattered across routes

[`backend/middleware/permission.js`] — every check is a function call inside a route handler. AWS-native alternative: declarative policies (IAM identity policies + condition keys + resource policies). Try it deliberately on Day 4–5 and **log the pain points of each style** — Kai will appreciate a thoughtful comparison.

### 5.5 Public-read S3 ACLs

[`backend/s3.js`] — `ACL: "public-read"` on upload. Default Team Vault Lite buckets to private; serve via short-TTL signed URLs. Block Public Access ON at the account level.

### 5.6 Audit log only on REVEAL

[`backend/prisma/schema.prisma:440–451`] — Team Vault Lite should log create/read/update/delete/reveal. **Preferred approach**: CloudTrail data events on KMS + DynamoDB Streams → Lambda → dedicated audit table, rather than imperative `prisma.audit.create()` calls scattered through handlers. Pain-point predict: CloudTrail data event volume + cost — high-density friction on Day 5.

### 5.7 Three separate S3 client initializations

[`backend/s3.js`, `backend/index.js:137–141`, `backend/routes/events.js:32–35`] — same credentials re-read into three SDK clients. Cosmetic, but a sign that secret retrieval was never abstracted. In Team Vault Lite, *no client ever reads credentials* — the SDK reads them from the Lambda execution role automatically. Lifts cleanly.

### 5.8 No rate limiting on auth/sensitive endpoints

Out of scope for the 8-day plan but worth one pain-log entry: *"In this stack, where does rate-limiting live? API Gateway usage plans? WAF? Cognito throttling? Multiple places? Surprising."*

---

## 6. Pain-points seed list (predictions to validate during the assignment)

These are the friction points predicted by mapping prior-project patterns onto AWS. Use as a **watchlist, not a script** — log each only when actually encountered, in your own words. Friction is the deliverable; preloaded notes don't count.

**Two-phase scope reminder**: pain log entries can come from Kai's Phase 1 tutorials AND from the Phase 2 build. The seam between them is where the highest-value entries live (e.g., *"the ABAC tutorial walked me through the canonical example; when I tried to apply it to my own DynamoDB partition-key design, X surprised me"*). Each day below notes whether a tutorial primes the topic.

### Day 1 — account, Identity Center, CLI

- "Identity Center instance ARN" vs "user portal URL" vs "start URL" — three different identifiers, each shown in a different console pane.
- Root user vs IAM user vs Identity Center user vs IAM Identity Center user: four overlapping vocabulary words.
- `aws configure sso` walks you through the same wizard whether or not your account has Identity Center enabled — early-error UX is poor.
- Credential resolution chain order (`~/.aws/credentials` → env vars → SSO cache → instance metadata) is documented but never visualized in one place.

### Day 2 — CDK bootstrap

- `cdk bootstrap` creates **5 IAM roles**, none of them explained in the CLI output. Each role's purpose takes one doc page to learn.
- First deploy fails with `iam:PassRole` denied. The error message names a role but not why PassRole is needed in CloudFormation. The most common first-time CDK error.
- CFN IAM capabilities prompt: `CAPABILITY_IAM` vs `CAPABILITY_NAMED_IAM` vs `CAPABILITY_AUTO_EXPAND`. CDK passes the right one for you, but the error message when you customize a synth doesn't tell you which.

### Day 3 — Cognito + Lambda

- **User pool ≠ identity pool.** Distinct services with overlapping names. User pool = identity provider; identity pool = STS credential broker.
- **ID token vs access token**: the API Gateway Cognito authorizer wants one specific kind. Pick wrong → 401 with no diagnostic. Cognito's docs improved recently but still don't lead with this.
- Cognito "groups" are **not** IAM groups. They're string labels in the `cognito:groups` claim of the ID token. Confusable name.
- Authorizer **default cache TTL is 5 minutes**. A freshly-promoted admin still sees the old role for ~5 min. Surprising in dev; production-acceptable.

### Day 4 — DynamoDB + condition keys

*Tutorial precedent: customer-managed-policy tutorial (#2) introduces condition keys generically; ABAC tutorial (#3) shows the principal-tag pattern. Day 4 friction is mostly "applying tutorial concepts to a real DynamoDB schema."*

- Writing your first condition key with `${cognito-identity.amazonaws.com:sub}` — figuring out whether to use `dynamodb:LeadingKeys` or `aws:PrincipalTag/<x>` takes 3+ doc visits even after the tutorials.
- `IfExists` operator semantics are subtle: applies to the *condition key*, not the *condition value*. Trap-prone. (Not covered in tutorial #2 or #3.)
- Per-row security with DynamoDB requires designing the partition key around the security model, not just the access pattern. The trade-off is non-obvious until you build it.

### Day 5 — KMS (the biggest day)

*Tutorial precedent: **none**. KMS is not covered by any of Kai's 7 IAM tutorials, even though it produces the highest-density IAM friction of any AWS-IAM-adjacent service. **This gap is itself a Day-1-deck-worthy observation** — log it explicitly: "the official IAM tutorial set onboards new users without teaching them the most painful surface they will hit."*

- **Key policy ↔ IAM identity policy double-grant.** Both must allow; either denying = denied. Predicted ~3–5 hours of *"why is this still denied"* until the model clicks. **Log every individual instance** — this is the highest-value content for Kai.
- `kms:GenerateDataKey` for envelope encryption *writes*; `kms:Decrypt` for *reads*. Granting one without the other = half-broken in a way that's not obvious until the next operation fails.
- Lambda execution role grants vs key policy grants: two different "principal lists" need to know about the same Lambda ARN.
- `kms:ViaService` condition key (e.g., `kms:ViaService = dynamodb.us-east-1.amazonaws.com`) — scopes key usage to a specific AWS service. Easy to forget; powerful when applied. Worth experimenting with.
- KMS does annual automatic rotation under the hood; you don't manage key material directly. Contrast with the prior-project pattern (`keyVersion` field, never used) and reflect on the API design difference.
- `aws kms describe-key` output is dense; the encryption context concept is mentioned but not motivated. Worth a pain log entry: *"what is encryption context, and when do I need it?"*

### Day 6 — ABAC stretch

*Tutorial precedent: ABAC tutorial (#3) is dedicated to this topic. Day 6 friction is "the tutorial's canonical example vs. my own design" — the divergence between tutorial-land and your stack is where the pain log entries live.*

- The ABAC tutorial's worked example covers the mechanics generically; translating to a Cognito + DynamoDB + Lambda stack adds layers the tutorial doesn't.
- `sts:TagSession` permission must be on the **trust policy**, not the identity policy. Universal first-time confusion (and the tutorial only mentions this in passing).
- Cognito → IAM principal tag mapping requires identity pool (not user pool). Surprising — and not covered in the tutorial because the tutorial uses generic IAM users, not Cognito.
- Attribute mappings configured in Cognito identity pool console — not in the user pool. Three clicks away from where you'd expect.

### Day 7 — Access Analyzer

- IAM Access Analyzer takes minutes to surface findings on a fresh stack. *"Did I do this wrong, or is it just slow?"* — unanswerable for the first 5 minutes.
- Unused Access Analyzer requires 90-day baselines to be useful — not testable in an 8-day window. **Pain point**: *"how does a new hire validate their least-privilege policy with zero usage history?"*
- IAM Access Analyzer's findings are categorized as "external access" vs "unused access" — two different analyzers with one product name. Easy to confuse.

---

## 7. Reference file map (verification only — do not copy)

For the broker session that wants to verify the patterns above by reading the prior code directly. **Read-only mental model.** Do not copy code into the broker repo.

```
backend/prisma/schema.prisma:414–451       GroupSecret + GroupSecretAccessLog models
backend/utils/groupSecretCrypto.js         AES-256-GCM envelope module (67 lines)
backend/utils/secretBox.js                 Calendly OAuth token encryption (89 lines)
backend/utils/jwt.js                       JWT sign/verify (9 lines)
backend/middleware/auth.js                 authGuard + optionalAuth (52 lines)
backend/middleware/permission.js           imperative authorization helpers (97 lines)
backend/routes/groupAccount.js:2238–2410   GroupSecret CRUD + reveal endpoints
backend/index.js:137–141                   S3 client init (root)
backend/index.js:207–219                   CORS allowlist
backend/index.js:221–229                   Stripe raw body middleware
backend/index.js:273–299                   Passport Google OAuth2 strategy
backend/s3.js                              S3 upload utilities (42 lines)
backend/routes/stripe.js:23–40             Stripe webhook signature verify
backend/utils/coachingCheckout.js:20–25    Stripe client init
backend/utils/mailer.js:10–11              SendGrid env
backend/utils/daily.js:12                  Daily.co env
backend/utils/smsVerify.js:5–9             Twilio env
mobile/src/api/client.ts:8–31              Mobile token storage in expo-secure-store
frontend/src/api.ts:760–793                Web token storage in localStorage + Bearer injection
frontend/src/auth.tsx:42–53                Login → setToken → state
agent-runtime/src/platform/auth.ts:8–82    Bearer parsing, JWT verify, Ed25519 issuer
```

The prior-project clone these resolve against is `~/Downloads/Git/stellen-analysis-readonly/` (per handoff §7) once created. Until then, this worktree session can verify them in-place.

---

## 8. What this document is NOT

- **Not a migration plan.** Team Vault Lite is a fresh build, not a port. The mapping table is a design influence, not a porting checklist.
- **Not exhaustive.** Only IAM-adjacent patterns are covered. Auth, encryption, audit, credential handling — yes. Business logic, billing, scheduling, UI — no.
- **Not authorization to copy code.** Patterns inform design; code lineage stays zero.
- **Not a substitute for the handoff doc.** Read `~/Documents/aws-iam-onboarding/handoff-context.md` first.
- **Not a pain log.** That lives in the broker repo at `aws-iam-broker/pain-log.md` (per handoff §9 step 4). This document *predicts*; the pain log *records*.

---

## 9. Open questions for the user

Things the broker session should ask the user about before relying heavily on a section:

1. **Was the `keyVersion` field ever intended to be used, or aspirational?** Affects whether to bring the field forward into Team Vault Lite's DynamoDB schema.
2. **Was the JWT_SECRET-as-encryption-fallback intentional dev convenience or oversight?** Affects how to characterize it in the antipatterns section if it shows up in the Day 1 deck.
3. **Is the user-as-group-admin pattern (`if (userId === groupId) return true`) a deliberate solo-account UX choice or a hack?** Affects how Team Vault Lite models a single-user vault vs a team vault.

These are flagged not because the answers change the AWS architecture, but because the Day 1 deck might mention them and Kai will ask follow-ups.

---

**End of reference analysis.**

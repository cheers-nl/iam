# AI-Assisted Policy Review vs IAM Access Analyzer — Empirical Comparison

> Generated 2026-05-14 by invoking a Bedrock-backed Lambda (Claude Opus 4.6) against the same 5 IAM test policies used in the D7 Access Analyzer (AA) `validate-policy` evaluation. The goal is to test the thesis that AI-assisted policy review can catch the IAM mistakes that static rule-based analyzers miss.

## Cost summary

Total: **~$0.30 for 5 policy reviews** at Opus 4.6 pricing. Per-policy cost is ~$0.05–$0.07. Practically negligible at developer scale; meaningful only at >10K policies/day.

## Side-by-side findings

### Test 1 — Our actual Lambda execution policy (Team Vault Lite)

| | AA `validate-policy` | AI advisor (Claude Opus 4.6) |
|---|---|---|
| Findings | **0** | **3** |
| Caught the overprovisioning? | No | **Yes** — flagged Scan/BatchWriteItem grants and `GenerateDataKey*`/`ReEncrypt*` wildcards |
| Caught the missing condition? | No | **Yes** — suggested `dynamodb:LeadingKeys` or `aws:SourceIp` |
| Caught policy hygiene? | No | Yes — Sid recommendation |

**Why this matters**: AA's `validate-policy` is by-design a syntax + best-practice check; it cannot detect overprovisioning without runtime data (that's what `unused-access` analyzer is for). AI did not need runtime data — it inferred the overprovisioning from the action list alone. **The AI's evidence-free hypothesis matched what we had observed manually in pain log entries #14 and #18.**

### Test 2 — Full admin (`*:*` on `*`)

| | AA | AI |
|---|---|---|
| Findings | 2 (PassRole, CreateServiceLinkedRole) | 4 (wildcard-action HIGH, privilege-escalation HIGH, missing-condition MED, hygiene LOW) |
| Coverage | Narrow — specific known-bad actions only | Broad — captures the *pattern* of full admin + identifies the privilege-escalation IAM actions explicitly |

**Why this matters**: AA's wildcard detection is keyed to specific dangerous actions (PassRole, ServiceLinkedRole). AI recognized the wildcard pattern as a whole AND enumerated the dangerous IAM actions it covers. Same coverage AA has, plus more.

### Test 3 — Principal:* trust policy (the canonical IAM mistake — Capital One)

| | AA | AI |
|---|---|---|
| Findings (correct flag) | **0** (with `--validate-policy-resource-type AWS::IAM::AssumeRolePolicyDocument`) | **3** (public-principal HIGH, missing-condition HIGH, hygiene LOW) |
| Caught the public principal? | **No** | **Yes** — explicitly flagged as "any entity in any AWS account" |

**This is the central thesis evidence**. The trust policy that AA's static validator does not catch — and that has caused real-world breaches — is exactly what AI catches. AA expects this to be caught by the *external-access* analyzer (continuous, post-deployment); AI catches it at the validate-policy moment, before the policy ever reaches AWS.

### Test 4 — Action/resource mismatch (`s3:GetObject` on an IAM role ARN)

| | AA | AI |
|---|---|---|
| Findings | **0** | **2** |
| Caught the mismatch? | No | **Yes** — explained that S3 actions only apply to S3 ARNs and the permission "will never take effect" |

**Why this matters**: AA only checks policy syntax; a syntactically valid policy with semantically-broken action/resource pairing passes. AI applies domain knowledge: S3 actions don't apply to IAM resources. AA could plausibly add this check but currently doesn't.

### Test 5 — `kms:*` on `*` (AA missed this in D7)

| | AA | AI |
|---|---|---|
| Findings | **0** | **5** (wildcard-action HIGH, privilege-escalation HIGH, wildcard-resource HIGH, missing-condition MED, hygiene LOW) |
| Caught the specific escalation? | No | **Yes** — identified that `kms:PutKeyPolicy` allows the principal to rewrite key policies, granting indirect access to all keys |

**Why this matters**: AA's wildcard detection didn't trigger because `kms:*` doesn't include the known-dangerous IAM actions AA looks for. AI recognized the service-specific escalation path (PutKeyPolicy + CreateGrant on KMS = effective key-policy-bypass).

## Summary observations

1. **AA missed 4 of 5 critical patterns** that newcomers care about (overprovisioning, public principal, action/resource mismatch, service-specific wildcard escalation).
2. **AI caught all 5 cases**, including AA's coverage (PassRole, ServiceLinkedRole patterns from Test 2).
3. **AI explained WHY** with service-specific knowledge (why `kms:PutKeyPolicy` matters; why S3 actions can't apply to IAM ARNs).
4. **AI occasionally over-flagged**: in Test 1 it suggested replacing `GenerateDataKey*` wildcards with explicit actions, even though the wildcards are commonly idiomatic for KMS usage. False-positive rate appears low but non-zero.
5. **Cost is negligible at developer scale**. Latency: each call took ~5–10 seconds with Opus 4.6 (acceptable for review workflow, not for inline runtime gating).

## Implications for the IAM team product strategy

These results suggest that **AI-assisted policy review is a high-leverage complement to static analysis**, not a replacement. Specifically:
- AA's strength: structural validation, fast, deterministic, free.
- AI's strength: semantic reasoning, cross-domain knowledge, narrative explanations a newcomer can act on.
- The two are **complementary** — AA can be the cheap pre-check, AI can be the deeper review for policies above a size or risk threshold.

A productized "IAM Policy Advisor" could:
- Auto-run on every new IAM policy in `cdk diff` output
- Flag findings AA didn't catch with severity + plain-language explanations
- Cost-bound by running only on policies that AA marked "no findings" (a heuristic that already filters out the easy cases)

This matches the team's current OP1 simplification mandate: doing the hard thinking on the customer's behalf so a newcomer can act on what they didn't know to ask about.

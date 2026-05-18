# Evidence — AI advisor vs IAM Access Analyzer

Raw, reproducible inputs and outputs for the AI advisor experiment described in [`../deliverable-6pager.md`](../deliverable-6pager.md) and [`../ai-vs-aa-comparison.md`](../ai-vs-aa-comparison.md).

## What's here

```
policies/              The 6 test policy JSON files used as input
aa-outputs/            Raw `aws accessanalyzer validate-policy` responses, one per policy
custom-check-outputs/  Raw Access Analyzer specialized-check outputs where applicable
ai-outputs/            Raw `aws lambda invoke` responses from the PolicyAdvisor function, one per policy
reproduce.sh           Idempotent shell script that re-runs both tools on all policies
```

## Reproducing

```
# Make sure SSO is fresh and the PolicyAdvisor Lambda is deployed:
aws sso login --profile personal-admin

# Run:
cd docs/evidence
./reproduce.sh
```

The script reads `policies/*.json`, calls `validate-policy` and the AI advisor for each policy, then runs `check-no-public-access` for the public trust-policy fixture where that specialized API applies. Idempotent — overwrites previous outputs.

## Summary of results

| Test policy | AA `validate-policy` | AA specialized check | AI findings | Main observation |
|---|---:|---|---:|---|
| `01-lambda-actual.json` (real Lambda baseline) | 0 | N/A (usage/overprovisioning belongs to unused-access analyzer) | 3 | AI hypothesized the same overprovisioning later seen via unused-access analysis. |
| `02-full-admin.json` (`"*":"*"` on `"*"`) | 2 | N/A (identity policy, not public resource policy) | 4 | AI caught AA's known-dangerous actions plus broader privilege-escalation context. |
| `03-public-trust.json` (`Principal: "*"`) | 0 | **FAIL** via `check-no-public-access` | 3 | AWS has the capability, but it lives behind a separate API; the gap is discoverability/workflow integration from `validate-policy`. |
| `04-action-resource-mismatch.json` (`s3:GetObject` on IAM ARN) | 0 | N/A (not a public resource-policy check) | 2 | AI caught a semantic action/resource mismatch. |
| `05-kms-wildcard.json` (`kms:*` on `"*"`) | 0 | N/A (identity policy, not public resource policy) | 5 | AI caught KMS-specific escalation paths. |
| `06-injection.json` (prompt-injection Sid + full admin) | 2 | N/A (identity policy, not public resource policy) | 4 | AI still flagged the policy and identified the suspicious Sid. |

## Model and cost

- Model: Claude Opus 4.6 on Amazon Bedrock, via the `us.anthropic.claude-opus-4-6-v1` inference profile
- Cost: ~$0.06 per policy review (Bedrock pricing, ~600 input tokens + ~400 output tokens per request)
- Total cost for the 6 reviews: ~$0.35

## What this evidence is NOT

- Not a benchmark — 6 hand-picked test cases, not a representative distribution
- Not a claim that AA lacks public-access detection. `check-no-public-access` correctly fails the public trust-policy fixture; the issue observed here is that `validate-policy` does not route the user to that adjacent check.
- Not blessed by a security review of the AI advisor's prompt
- Not safe to run in CI without rate-limit and budget guards

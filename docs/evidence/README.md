# Evidence — AI advisor vs IAM Access Analyzer

Raw, reproducible inputs and outputs for the AI advisor experiment described in [`../deliverable-6pager.md`](../deliverable-6pager.md) and [`../ai-vs-aa-comparison.md`](../ai-vs-aa-comparison.md).

## What's here

```
policies/         The 5 test policy JSON files used as input
aa-outputs/       Raw `aws accessanalyzer validate-policy` responses, one per policy
ai-outputs/       Raw `aws lambda invoke` responses from the PolicyAdvisor function, one per policy
reproduce.sh      Idempotent shell script that re-runs both tools on all policies
```

## Reproducing

```
# Make sure SSO is fresh and the PolicyAdvisor Lambda is deployed:
aws sso login --profile personal-admin

# Run:
cd docs/evidence
./reproduce.sh
```

The script reads `policies/*.json`, calls each tool, and writes raw responses to `aa-outputs/` and `ai-outputs/`. Idempotent — overwrites previous outputs.

## Summary of results

| Test policy | AA findings | AI findings | AI caught what AA missed? |
|---|---|---|---|
| `01-lambda-actual.json` (real Lambda baseline) | 0 | 3 (hygiene + overprovision observations) | Yes |
| `02-full-admin.json` (`"*":"*"` on `"*"`) | 2 (CreateServiceLinkedRole + PassRole warnings) | 4 (incl. wildcard-action HIGH, privilege-escalation HIGH) | Yes (deeper coverage) |
| `03-public-trust.json` (`Principal: "*"`) | **0** | 3 (incl. **public-principal HIGH** — the Capital One pattern) | **Yes — headline catch** |
| `04-action-resource-mismatch.json` (`s3:GetObject` on IAM ARN) | 0 | 2 (incl. action-resource-mismatch HIGH) | Yes |
| `05-kms-wildcard.json` (`kms:*` on `"*"`) | 0 | 5 (incl. wildcard-action HIGH, privilege-escalation HIGH, wildcard-resource HIGH) | Yes |

## Model and cost

- Model: Claude Opus 4.6 on Amazon Bedrock, via the `us.anthropic.claude-opus-4-6-v1` inference profile
- Cost: ~$0.06 per policy review (Bedrock pricing, ~600 input tokens + ~400 output tokens per request)
- Total cost for the 5 reviews: ~$0.30

## What this evidence is NOT

- Not a benchmark — 5 hand-picked test cases, not a representative distribution
- Not a comparison of AA's full surface — only `validate-policy`. AA's separate unused-access analyzer and external-access analyzer have their own (often complementary) strengths
- Not blessed by a security review of the AI advisor's prompt
- Not safe to run in CI without rate-limit and budget guards

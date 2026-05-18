#!/usr/bin/env bash
# Reproducer for the AI advisor vs IAM Access Analyzer comparison.
#
# Re-runs the same test policies through both tools and writes raw
# outputs alongside this script. Idempotent.
#
# Requirements:
#   - AWS CLI configured (e.g. `aws sso login --profile personal-admin`)
#   - python3 in PATH
#   - PolicyAdvisor Lambda deployed (CDK stack output: PolicyAdvisorFunctionName)
#   - Bedrock model access enabled for us.anthropic.claude-opus-4-6-v1
set -euo pipefail

PROFILE="${AWS_PROFILE:-personal-admin}"
REGION="${AWS_REGION:-us-west-2}"
ADVISOR_FN_NAME="${POLICY_ADVISOR_FUNCTION:-$(aws cloudformation describe-stacks --stack-name TeamVaultLite --query 'Stacks[0].Outputs[?OutputKey==`PolicyAdvisorFunctionName`].OutputValue' --output text --region "$REGION" --profile "$PROFILE")}"

DIR="$(cd "$(dirname "$0")" && pwd)"
POLICIES_DIR="$DIR/policies"
AA_OUT="$DIR/aa-outputs"
AI_OUT="$DIR/ai-outputs"
CUSTOM_OUT="$DIR/custom-check-outputs"
mkdir -p "$AA_OUT" "$AI_OUT" "$CUSTOM_OUT"

for policy_file in "$POLICIES_DIR"/*.json; do
  name="$(basename "$policy_file" .json)"
  echo "==> $name"

  # Policy type: trust policy is RESOURCE_POLICY, others are IDENTITY_POLICY.
  if [[ "$name" == "03-public-trust" ]]; then
    POLICY_TYPE="RESOURCE_POLICY"
    EXTRA_ARGS=(--validate-policy-resource-type 'AWS::IAM::AssumeRolePolicyDocument')
  else
    POLICY_TYPE="IDENTITY_POLICY"
    EXTRA_ARGS=()
  fi

  # IAM Access Analyzer validate-policy.
  aws accessanalyzer validate-policy \
    --policy-document "file://$policy_file" \
    --policy-type "$POLICY_TYPE" \
    ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} \
    --region "$REGION" \
    --profile "$PROFILE" \
    > "$AA_OUT/$name.json"

  # AI advisor Lambda. Wraps the raw policy in the advisor's payload shape.
  WRAPPED_PAYLOAD="$(python3 -c "
import json
policy = json.load(open('$policy_file'))
print(json.dumps({'policyDocument': policy, 'policyType': '$POLICY_TYPE'}))
")"

  echo "$WRAPPED_PAYLOAD" > /tmp/advisor-payload.json
	  aws lambda invoke \
	    --function-name "$ADVISOR_FN_NAME" \
	    --payload "fileb:///tmp/advisor-payload.json" \
	    --cli-binary-format raw-in-base64-out \
	    --region "$REGION" \
	    --profile "$PROFILE" \
	    "$AI_OUT/$name.json" > /dev/null
done

# Access Analyzer's public-access check is a separate API with a narrower
# applicability surface than validate-policy. It applies to the public trust
# policy fixture; the identity-policy fixtures are intentionally N/A.
aws accessanalyzer check-no-public-access \
  --policy-document "file://$POLICIES_DIR/03-public-trust.json" \
  --resource-type 'AWS::IAM::AssumeRolePolicyDocument' \
  --region "$REGION" \
  --profile "$PROFILE" \
  > "$CUSTOM_OUT/03-public-trust-check-no-public-access.json"

echo ""
echo "Done. Outputs in:"
echo "  AA validate-policy: $AA_OUT/"
echo "  AA custom checks:   $CUSTOM_OUT/"
echo "  AI advisor:         $AI_OUT/"

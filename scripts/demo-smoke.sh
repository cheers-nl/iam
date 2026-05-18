#!/usr/bin/env bash
set -euo pipefail

PROFILE="${AWS_PROFILE:-personal-admin}"
REGION="${AWS_REGION:-us-west-2}"
STACK="${STACK_NAME:-TeamVaultLite}"

stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey==\`$1\`].OutputValue" \
    --output text \
    --region "$REGION" \
    --profile "$PROFILE"
}

expect_eq() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label (expected $expected, got $actual)" >&2
    exit 1
  fi
  echo "OK: $label"
}

CF_URL="$(stack_output CloudFrontUrl)"
API_URL="$(stack_output ApiUrl)"
USER_POOL_ID="$(stack_output UserPoolId)"
TABLE_NAME="$(stack_output VaultTableName)"

code="$(curl -sS -o /dev/null -w '%{http_code}' "$CF_URL")"
expect_eq "$code" "200" "CloudFront web app returns 200"

code="$(curl -sS -o /tmp/team-vault-api-smoke.json -w '%{http_code}' -H "Origin: $CF_URL" "${API_URL}secrets")"
expect_eq "$code" "401" "unauthenticated API returns 401"

preflight="$(curl -sS -D - -o /dev/null \
  -X OPTIONS "${API_URL}secrets/demo-secret-id" \
  -H "Origin: $CF_URL" \
  -H "Access-Control-Request-Method: DELETE" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type")"
if ! grep -qi 'access-control-allow-methods:.*DELETE' <<<"$preflight"; then
  echo "FAIL: DELETE preflight does not allow DELETE" >&2
  echo "$preflight" >&2
  exit 1
fi
echo "OK: DELETE preflight allows DELETE"

aws cognito-idp get-group --user-pool-id "$USER_POOL_ID" --group-name vault-admin --region "$REGION" --profile "$PROFILE" >/dev/null
aws cognito-idp get-group --user-pool-id "$USER_POOL_ID" --group-name vault-member --region "$REGION" --profile "$PROFILE" >/dev/null
echo "OK: Cognito vault-admin and vault-member groups exist"

secret_count="$(aws dynamodb query \
  --table-name "$TABLE_NAME" \
  --key-condition-expression 'pk = :pk AND begins_with(sk, :prefix)' \
  --expression-attribute-values '{":pk":{"S":"TEAM#default"},":prefix":{"S":"SECRET#"}}' \
  --select COUNT \
  --query Count \
  --output text \
  --region "$REGION" \
  --profile "$PROFILE")"
echo "OK: DynamoDB secret rows = $secret_count"

audit_count="$(aws dynamodb query \
  --table-name "$TABLE_NAME" \
  --key-condition-expression 'pk = :pk AND begins_with(sk, :prefix)' \
  --expression-attribute-values '{":pk":{"S":"TEAM#default"},":prefix":{"S":"AUDIT#"}}' \
  --select COUNT \
  --query Count \
  --output text \
  --region "$REGION" \
  --profile "$PROFILE")"
echo "OK: DynamoDB audit rows = $audit_count"

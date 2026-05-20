#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <secret_id>" >&2
  exit 2
fi

SECRET_ID="$1"
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

TABLE_NAME="$(stack_output VaultTableName)"
KEY_ARN="$(stack_output VaultKeyArn)"

echo "== Application audit rows for secret: $SECRET_ID =="
aws dynamodb query \
  --table-name "$TABLE_NAME" \
  --key-condition-expression 'pk = :pk AND begins_with(sk, :prefix)' \
  --filter-expression 'secretId = :secretId' \
  --expression-attribute-values "{\":pk\":{\"S\":\"TEAM#default\"},\":prefix\":{\"S\":\"AUDIT#\"},\":secretId\":{\"S\":\"$SECRET_ID\"}}" \
  --no-scan-index-forward \
  --limit 20 \
  --region "$REGION" \
  --profile "$PROFILE" \
  --output json

echo ""
echo "== Recent CloudTrail KMS Decrypt events for vault key =="
echo "(CloudTrail lookup can lag a few minutes after a reveal.)"
cloudtrail_tmp="$(mktemp)"
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=Decrypt \
  --max-results 50 \
  --region "$REGION" \
  --profile "$PROFILE" \
  --output json > "$cloudtrail_tmp"
KEY_ARN="$KEY_ARN" python3 - "$cloudtrail_tmp" <<'PY'
import json
import os
import sys

key_arn = os.environ["KEY_ARN"]
events = json.load(open(sys.argv[1])).get("Events", [])
rows = []
for event in events:
    resources = event.get("Resources") or []
    if not any(resource.get("ResourceName") == key_arn for resource in resources):
        continue
    raw = json.loads(event.get("CloudTrailEvent", "{}"))
    identity = raw.get("userIdentity", {})
    rows.append({
        "eventTime": event.get("EventTime").isoformat() if hasattr(event.get("EventTime"), "isoformat") else str(event.get("EventTime")),
        "username": event.get("Username"),
        "principalArn": identity.get("arn"),
        "userAgent": raw.get("userAgent"),
        "encryptionContext": (raw.get("requestParameters") or {}).get("encryptionContext"),
    })

print(json.dumps(rows[:10], indent=2, default=str))
PY
rm -f "$cloudtrail_tmp"

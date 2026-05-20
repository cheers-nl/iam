import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

// Cross-region inference profile — routes to whichever US region has capacity.
// The IAM policy attached to this Lambda must allow bedrock:InvokeModel on
// BOTH the inference profile ARN AND all underlying foundation-model ARNs
// across the regions the profile may route to (us-east-1, us-east-2, us-west-2).
// Getting this wrong produces an AccessDeniedException that says nothing about
// the cross-region part — a known IAM friction point.
const MODEL_ID = 'us.anthropic.claude-opus-4-6-v1';

const bedrock = new BedrockRuntimeClient({});

const SYSTEM_PROMPT = `You are an experienced AWS IAM security analyst. You review IAM policies for security issues that a less-experienced engineer would miss.

For each policy presented, you identify ALL issues including:
- Overly broad permissions (wildcards in actions or resources, especially without conditions)
- Dangerous trust-policy patterns (e.g., Principal: "*" with no Condition; allowing assume from any account)
- Action/resource mismatches (e.g., s3:GetObject scoped to an IAM role ARN — the action would never apply)
- Missing best-practice conditions (e.g., no aws:SourceAccount/aws:PrincipalOrgID on cross-account access)
- Privilege-escalation risks (iam:PassRole with broad resources, iam:CreatePolicyVersion, sts:AssumeRole without scope)
- Subtle service-specific risks (e.g., kms:* lets the principal change the key policy itself; lambda:InvokeFunction on '*' is broader than it looks)
- Policy hygiene issues (no Sid, duplicated statements, redundant grants)

For each issue found, output:
- severity: HIGH | MEDIUM | LOW
- category: short label (e.g., "wildcard-action", "public-principal", "missing-condition", "action-resource-mismatch", "privilege-escalation")
- issue: 1-2 sentence description of the problem
- recommendation: how to fix it concretely

Output ONLY a single JSON object with this structure (no markdown fences, no preamble, no trailing prose):
{
  "findings": [
    {"severity": "HIGH", "category": "...", "issue": "...", "recommendation": "..."}
  ],
  "summary": "1-sentence overall assessment of the policy"
}

If you find no issues, return: {"findings": [], "summary": "Policy appears reasonable."}`;

type Finding = {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  issue: string;
  recommendation: string;
};

type AdvisorResponse = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  findings: Finding[];
  summary: string;
  rawText?: string;
};

export const handler = async (event: {
  policyDocument: unknown;
  policyType?: string;
}): Promise<AdvisorResponse | { error: string; raw?: string }> => {
  const { policyDocument, policyType = 'IDENTITY_POLICY' } = event;
  if (!policyDocument) {
    return { error: 'policyDocument is required' };
  }

  const userMessage = `Policy type: ${policyType}\n\nPolicy document:\n${JSON.stringify(
    policyDocument,
    null,
    2
  )}`;

  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  };

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    })
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const claudeText = responseBody.content[0].text as string;

  let parsed: { findings: Finding[]; summary: string };
  try {
    parsed = JSON.parse(claudeText);
  } catch {
    // Try stripping markdown fences if present.
    const fenced = claudeText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenced) {
      parsed = JSON.parse(fenced[1]);
    } else {
      return {
        error: 'Could not parse advisor response as JSON',
        raw: claudeText,
      };
    }
  }

  return {
    model: MODEL_ID,
    inputTokens: responseBody.usage.input_tokens,
    outputTokens: responseBody.usage.output_tokens,
    findings: parsed.findings,
    summary: parsed.summary,
  };
};

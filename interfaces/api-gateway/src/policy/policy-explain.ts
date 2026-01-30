import type { Intent } from "../intent/intent-model";
import type { PolicyRecord } from "./policy-store";
import type { ExecutionMode } from "./policy-types";

export type PolicyExplainResponse = {
  traceId: string;
  executionMode: ExecutionMode;
  intent: Intent;
  decision: PolicyRecord["decision"];
  reasons: string[];
  evaluatedAt: string;
};

export function buildPolicyExplainResponse(input: {
  traceId: string;
  executionMode: ExecutionMode;
  intent: Intent;
  policy: PolicyRecord;
}): PolicyExplainResponse {
  return {
    traceId: input.traceId,
    executionMode: input.executionMode,
    intent: input.intent,
    decision: input.policy.decision,
    reasons: input.policy.reasons,
    evaluatedAt: input.policy.evaluatedAt
  };
}

import type { Intent } from "../intent/intent-model";
import type { PolicyDecisionRecord } from "../policy/policy-store";
import type { ExecutionMode, PolicyInfo, RiskAssessment } from "./types";

export type PolicyExplainResponse = {
  traceId: string;
  policy: PolicyInfo;
  intentSummary: {
    intentType: Intent["intentType"];
    entities: Intent["entities"];
    confidence: number;
  };
  executionMode: ExecutionMode;
  decision: {
    final: PolicyDecisionRecord["decision"];
    matchedRules: PolicyDecisionRecord["matchedRuleIds"];
    reasons: PolicyDecisionRecord["reasons"];
    categories: PolicyDecisionRecord["categories"];
  };
  risk: RiskAssessment;
};

export function buildPolicyExplainResponse(input: {
  traceId: string;
  intent: Intent;
  executionMode: ExecutionMode;
  policyRecord: PolicyDecisionRecord;
  policyInfo: PolicyInfo;
}): PolicyExplainResponse {
  return {
    traceId: input.traceId,
    policy: input.policyInfo,
    intentSummary: {
      intentType: input.intent.intentType,
      entities: input.intent.entities,
      confidence: input.intent.confidence
    },
    executionMode: input.executionMode,
    decision: {
      final: input.policyRecord.decision,
      matchedRules: input.policyRecord.matchedRuleIds,
      reasons: input.policyRecord.reasons,
      categories: input.policyRecord.categories
    },
    risk: input.policyRecord.risk
  };
}

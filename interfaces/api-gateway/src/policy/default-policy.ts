import type { Intent } from "../intent/intent-model";
import type { PolicyEngine } from "./policy-engine";
import type { PolicyContext, PolicyDecisionResult } from "./policy-types";

export type DefaultPolicyOptions = {
  confidenceThreshold: number;
};

const HIGH_RISK = "high";

export function createDefaultPolicyEngine(options: DefaultPolicyOptions): PolicyEngine {
  return {
    evaluate(intent: Intent, context: PolicyContext): PolicyDecisionResult {
      if (intent.confidence < options.confidenceThreshold) {
        return {
          decision: "DENY",
          reasons: ["Intent confidence below policy threshold."],
          requiredApprovals: []
        };
      }

      const risk = (intent as Intent & { risk?: string }).risk;
      if (context.executionMode === "auto" && risk === HIGH_RISK) {
        return {
          decision: "WARN",
          reasons: ["High-risk intent flagged for auto execution."],
          requiredApprovals: []
        };
      }

      return { decision: "ALLOW", reasons: [], requiredApprovals: [] };
    }
  };
}

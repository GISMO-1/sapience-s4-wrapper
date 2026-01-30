import type { Intent } from "../intent/intent-model";
import type { PolicyContext, PolicyDecisionResult } from "./policy-types";

export interface PolicyEngine {
  evaluate(intent: Intent, context: PolicyContext): PolicyDecisionResult;
}

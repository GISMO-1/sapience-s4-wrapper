import type { GuardrailDecision } from "../policy-promotion-guardrails/types";

export type PolicyPromotionInput = {
  policyHash: string;
  evaluatedAt: string;
  reviewer: string;
  rationale: string;
  acceptedRisk?: number | null;
  forced: boolean;
  guardrailDecision: GuardrailDecision;
};

export type PolicyPromotionRecord = PolicyPromotionInput & {
  id: string;
  createdAt: string;
};

export type DecisionType = "EXECUTION" | "PROMOTION" | "ROLLBACK" | "COUNTERFACTUAL";
export type DecisionOutcome = "ALLOW" | "DENY" | "WARN" | "FAIL";
export type RationaleBlockType =
  | "RULE_EVALUATION"
  | "GUARDRAIL_CHECK"
  | "THRESHOLD_CROSSED"
  | "HUMAN_OVERRIDE";

export type RationaleBlock = {
  type: RationaleBlockType;
  summary: string;
  entries: string[];
};

export type RejectedAlternative = {
  label: string;
  delta: number;
  details?: string | null;
};

export type AcceptedRisk = {
  severity: "LOW" | "MEDIUM" | "HIGH";
  justification: string;
  reviewer?: string | null;
  score?: number | null;
};

export type DecisionRationaleTimestamps = {
  decidedAt: string;
  recordedAt: string;
};

export type DecisionRationale = {
  decisionId: string;
  traceId: string;
  policyHash: string;
  decisionType: DecisionType;
  outcome: DecisionOutcome;
  confidenceScore: number;
  rationaleBlocks: RationaleBlock[];
  rejectedAlternatives: RejectedAlternative[];
  acceptedRisk: AcceptedRisk;
  timestamps: DecisionRationaleTimestamps;
};

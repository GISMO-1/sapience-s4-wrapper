export type PolicyDecision = "ALLOW" | "WARN" | "DENY";

export type PolicyDecisionResult = {
  decision: PolicyDecision;
  reasons: string[];
};

export type ExecutionMode = "manual" | "auto" | "simulate";

export type PolicyContext = {
  executionMode: ExecutionMode;
  traceId: string;
};

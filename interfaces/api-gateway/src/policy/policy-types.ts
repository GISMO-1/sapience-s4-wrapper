export type PolicyDecision = "ALLOW" | "WARN" | "DENY";

export type PolicyDecisionResult = {
  decision: PolicyDecision;
  reasons: string[];
  requiredApprovals: Array<{ role: string; reason: string }>;
};

export type ExecutionMode = "manual" | "auto" | "simulate";

export type PolicyContext = {
  executionMode: ExecutionMode;
  traceId: string;
};

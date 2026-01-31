import type { Intent } from "../intent/intent-model";
import type { PolicyDecision } from "../policy-code/types";

export type PolicyOutcomeType = "success" | "failure" | "override" | "rollback";

export type PolicyOutcomeRecord = {
  id: string;
  traceId: string;
  intentType: Intent["intentType"];
  policyHash: string;
  decision: PolicyDecision;
  outcomeType: PolicyOutcomeType;
  severity: number;
  humanOverride: boolean;
  notes?: string | null;
  observedAt: Date;
  createdAt: Date;
};

export type PolicyOutcomeInput = {
  traceId: string;
  intentType: Intent["intentType"];
  policyHash: string;
  decision: PolicyDecision;
  outcomeType: PolicyOutcomeType;
  severity: number;
  humanOverride: boolean;
  notes?: string | null;
  observedAt?: Date;
};

export type PolicyOutcomeFilters = {
  policyHash?: string;
  since?: Date;
  until?: Date;
  limit?: number;
};

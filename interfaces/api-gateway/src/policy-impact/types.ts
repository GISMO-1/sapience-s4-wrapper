import type { Intent } from "../intent/intent-model";
import type { PolicyDecision } from "../policy-code/types";

export type ImpactClassification =
  | "UNCHANGED"
  | "NEWLY_BLOCKED"
  | "NEWLY_ALLOWED"
  | "APPROVAL_ESCALATED"
  | "APPROVAL_RELAXED"
  | "SEVERITY_INCREASED"
  | "SEVERITY_DECREASED";

export type ImpactRow = {
  intentId: string;
  traceId: string;
  intentType: Intent["intentType"];
  prevDecision: PolicyDecision;
  nextDecision: PolicyDecision;
  prevApprovalsRequired: string[];
  nextApprovalsRequired: string[];
  prevSeverity: number;
  nextSeverity: number;
  classifications: ImpactClassification[];
};

export type PolicyImpactReport = {
  policyHashCurrent: string;
  policyHashCandidate: string;
  window: {
    since: string;
    until: string;
  };
  totals: {
    intentsEvaluated: number;
    newlyBlocked: number;
    newlyAllowed: number;
    approvalEscalations: number;
    severityIncreases: number;
  };
  blastRadiusScore: number;
  rows: ImpactRow[];
};

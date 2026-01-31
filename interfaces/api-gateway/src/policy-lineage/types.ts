export type PolicyLineageSource = "replay" | "manual";

export type PolicyDriftSummary = {
  constraintsAdded: number;
  constraintsRemoved: number;
  severityDelta: number;
  netRiskScoreChange: number;
};

export type PolicyLineageRecord = {
  policyHash: string;
  parentPolicyHash: string | null;
  promotedBy: string;
  promotedAt: string;
  rationale: string;
  acceptedRiskScore: number;
  source: PolicyLineageSource;
  drift: PolicyDriftSummary;
};

export type PolicyLineageInput = {
  policyHash: string;
  parentPolicyHash: string | null;
  promotedBy: string;
  promotedAt: string;
  rationale: string;
  acceptedRiskScore: number;
  source: PolicyLineageSource;
  drift: PolicyDriftSummary;
};

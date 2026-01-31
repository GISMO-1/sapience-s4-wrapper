export type PolicyLifecycleState = "draft" | "simulated" | "approved" | "active";
export type PolicyCandidateSource = "current" | "path" | "inline";

export type PolicyApproval = {
  approvedBy: string;
  approvedAt: string;
  reason: string;
  rationale?: string;
  acceptedRiskScore?: number;
  notes?: string;
  runId: string;
};

export type PolicySnapshotStatus = {
  policyHash: string;
  state: PolicyLifecycleState;
  updatedAt: string;
  source?: PolicyCandidateSource;
  ref?: string | null;
  inlineYaml?: string | null;
  approval?: PolicyApproval;
};

export type PolicyImpactWeights = {
  changedDecisions: number;
  denyToAllowFlips: number;
  rateLimitViolations: number;
  highRiskSignals: number;
};

export type PolicyImpactCounts = {
  changedDecisions: number;
  denyToAllowFlips: number;
  rateLimitViolations: number;
  highRiskSignals: number;
};

export type PolicyImpactThresholds = PolicyImpactCounts & {
  score: number;
};

export type PolicyImpactConfig = {
  weights: PolicyImpactWeights;
  thresholds: PolicyImpactThresholds;
};

export type PolicyImpactReport = {
  score: number;
  weights: PolicyImpactWeights;
  counts: PolicyImpactCounts;
  thresholds: PolicyImpactThresholds;
  exceeded: string[];
  blocked: boolean;
};

export type PolicyLifecycleRecord = PolicySnapshotStatus & {
  version?: string;
  path?: string;
  loadedAt?: string;
};

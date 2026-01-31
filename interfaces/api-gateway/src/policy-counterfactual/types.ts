export type CounterfactualRequest = {
  policyHash: string;
  compareToPolicyHash?: string;
  since?: string;
  until?: string;
  limit?: number;
};

export type CounterfactualOutcomeDelta = {
  outcomeType: string;
  beforeCount: number;
  afterCount: number;
  delta: number;
  severityShift?: {
    beforeAvg: number;
    afterAvg: number;
    delta: number;
  };
};

export type BlastRadiusReport = {
  policyHash: string;
  baselinePolicyHash: string;
  window: { since: string; until: string };
  intentsAffected: number;
  tracesAffected: number;
  outcomes: CounterfactualOutcomeDelta[];
  approvalRateDelta?: number;
  rejectionRateDelta?: number;
  riskScoreDelta?: number;
  reportHash: string;
};

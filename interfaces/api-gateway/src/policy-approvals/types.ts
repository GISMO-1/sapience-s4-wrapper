export type PolicyApprovalInput = {
  policyHash: string;
  approvedBy: string;
  approvedAt: string;
  rationale: string;
  acceptedRiskScore?: number | null;
  notes?: string | null;
  runId?: string | null;
};

export type PolicyApprovalRecord = PolicyApprovalInput & {
  id: string;
  createdAt: string;
};

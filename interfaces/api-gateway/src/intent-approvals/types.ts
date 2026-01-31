export type IntentApprovalRecord = {
  id: string;
  traceId: string;
  intentId: string;
  policyHash: string;
  decisionId: string;
  requiredRole: string;
  actor: string;
  rationale: string;
  approvedAt: Date;
};

export type IntentApprovalInput = {
  traceId: string;
  intentId: string;
  policyHash: string;
  decisionId: string;
  requiredRole: string;
  actor: string;
  rationale: string;
  approvedAt?: Date;
};

export type IntentApprovalStore = {
  recordApproval: (input: IntentApprovalInput) => Promise<IntentApprovalRecord>;
  listApprovalsByTraceId: (traceId: string) => Promise<IntentApprovalRecord[]>;
};

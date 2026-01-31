import type { PolicyConstraint, PolicyRule } from "../policy-code/types";

export type RollbackRequest = {
  targetPolicyHash: string;
  actor: string;
  rationale: string;
  dryRun?: boolean;
};

export type RollbackDecision = {
  ok: boolean;
  fromPolicyHash: string;
  toPolicyHash: string;
  decisionHash: string;
  reasons: string[];
  createdAt: string;
};

export type RollbackEvent = {
  eventType: "ROLLBACK";
  eventHash: string;
  fromPolicyHash: string;
  toPolicyHash: string;
  actor: string;
  rationale: string;
  createdAt: string;
};

export type RuleSnapshot = {
  ruleId: string;
  rule: PolicyRule;
  approvalRoles: string[];
};

export type RuleModificationDelta = {
  enabledChanged: boolean;
  decisionChanged: boolean;
  priorityDelta: number;
  tagsAdded: string[];
  tagsRemoved: string[];
  intentTypesAdded: string[];
  intentTypesRemoved: string[];
  constraintsAdded: PolicyConstraint[];
  constraintsRemoved: PolicyConstraint[];
  approvalsAdded: string[];
  approvalsRemoved: string[];
};

export type RuleModified = {
  ruleId: string;
  before: RuleSnapshot;
  after: RuleSnapshot;
  changes: RuleModificationDelta;
};

export type ReconcileSummary = {
  rulesAdded: number;
  rulesRemoved: number;
  rulesModified: number;
  approvalsAdded: string[];
  approvalsRemoved: string[];
  defaultsChanged: boolean;
  autoExecutionApprovalsChanged: boolean;
};

export type ReconcileReport = {
  fromPolicyHash: string;
  toPolicyHash: string;
  summary: ReconcileSummary;
  rulesAdded: RuleSnapshot[];
  rulesRemoved: RuleSnapshot[];
  rulesModified: RuleModified[];
  reportHash: string;
};

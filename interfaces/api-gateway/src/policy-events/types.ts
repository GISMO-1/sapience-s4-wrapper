import type { ReplayCandidateSource, ReplayResultRecord } from "../policy-replay/types";
import type { PolicyDecision } from "../policy-code/types";
import type { PolicyOutcomeType } from "../policy-outcomes/types";
import type { GuardrailDecision } from "../policy-promotion-guardrails/types";

export type PolicyEventKind =
  | "POLICY_REPLAY_RUN_STARTED"
  | "POLICY_REPLAY_RESULT_RECORDED"
  | "POLICY_OUTCOME_RECORDED"
  | "POLICY_PROMOTION_GUARDRAIL_CHECKED"
  | "POLICY_PROMOTED"
  | "POLICY_APPROVAL_RECORDED";

export type PolicyReplayRunStartedPayload = {
  runId: string;
  baselinePolicyHash: string;
  candidatePolicyHash: string;
  candidatePolicySource: ReplayCandidateSource;
  candidatePolicyRef: string | null;
  intentTypeFilter: string[] | null;
  since: string | null;
  until: string | null;
  limit: number;
};

export type PolicyReplayResultPayload = {
  resultId: string;
  runId: string;
  traceId: string;
  intentType: ReplayResultRecord["intentType"];
  baselineDecision: ReplayResultRecord["baselineDecision"];
  candidateDecision: ReplayResultRecord["candidateDecision"];
  changed: boolean;
  baselinePolicyHash: string;
  candidatePolicyHash: string;
  baselineMatchedRules: string[];
  candidateMatchedRules: string[];
  candidateConstraintTypes: string[];
  baselineRisk: ReplayResultRecord["baselineRisk"];
  risk: ReplayResultRecord["risk"];
};

export type PolicyOutcomePayload = {
  outcomeId: string;
  traceId: string;
  intentType: ReplayResultRecord["intentType"];
  decision: PolicyDecision;
  outcomeType: PolicyOutcomeType;
  severity: number;
  humanOverride: boolean;
  notes: string | null;
};

export type PolicyGuardrailCheckPayload = {
  checkId: string;
  actor: string;
  rationale: string;
  decision: GuardrailDecision;
};

export type PolicyPromotedPayload = {
  parentPolicyHash: string | null;
  promotedBy: string;
  rationale: string;
  acceptedRiskScore: number;
  source: "replay" | "manual";
  drift: {
    constraintsAdded: number;
    constraintsRemoved: number;
    severityDelta: number;
    netRiskScoreChange: number;
  };
};

export type PolicyApprovalPayload = {
  approvalId: string;
  approvedBy: string;
  rationale: string;
  acceptedRiskScore: number | null;
  notes: string | null;
  runId: string | null;
  approvedAt: string;
};

export type PolicyEventBase<TKind extends PolicyEventKind, TPayload> = {
  eventId: string;
  occurredAt: string;
  actor: string | null;
  traceId: string | null;
  policyHash: string | null;
  kind: TKind;
  payload: TPayload;
  parentEventId: string | null;
  eventHash: string;
};

export type PolicyReplayRunStartedEvent = PolicyEventBase<
  "POLICY_REPLAY_RUN_STARTED",
  PolicyReplayRunStartedPayload
>;

export type PolicyReplayResultRecordedEvent = PolicyEventBase<
  "POLICY_REPLAY_RESULT_RECORDED",
  PolicyReplayResultPayload
>;

export type PolicyOutcomeRecordedEvent = PolicyEventBase<"POLICY_OUTCOME_RECORDED", PolicyOutcomePayload>;

export type PolicyGuardrailCheckEvent = PolicyEventBase<
  "POLICY_PROMOTION_GUARDRAIL_CHECKED",
  PolicyGuardrailCheckPayload
>;

export type PolicyPromotedEvent = PolicyEventBase<"POLICY_PROMOTED", PolicyPromotedPayload>;

export type PolicyApprovalRecordedEvent = PolicyEventBase<"POLICY_APPROVAL_RECORDED", PolicyApprovalPayload>;

export type PolicyEvent =
  | PolicyReplayRunStartedEvent
  | PolicyReplayResultRecordedEvent
  | PolicyOutcomeRecordedEvent
  | PolicyGuardrailCheckEvent
  | PolicyPromotedEvent
  | PolicyApprovalRecordedEvent;

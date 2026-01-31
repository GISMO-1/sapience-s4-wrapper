import type { PolicyLineageRecord } from "../policy-lineage/types";
import type { PolicyApprovalRecord } from "../policy-approvals/types";
import type { ReplayRunRecord } from "../policy-replay/types";
import type { GuardrailCheckRecord } from "../policy-promotion-guardrails/types";
import type { RollbackEvent } from "../policy-rollback/types";

export enum PolicyLifecycleState {
  DRAFT = "DRAFT",
  SIMULATED = "SIMULATED",
  GUARDED = "GUARDED",
  APPROVED = "APPROVED",
  ACTIVE = "ACTIVE",
  SUPERSEDED = "SUPERSEDED"
}

export type PolicyLifecycleEventType = "simulation" | "guardrail_check" | "approval" | "promotion" | "rollback";

export type PolicyLifecycleEvent = {
  type: PolicyLifecycleEventType;
  timestamp: string;
  actor: string;
  rationale: string;
};

export type PolicyLifecycleTimeline = {
  state: PolicyLifecycleState;
  events: PolicyLifecycleEvent[];
};

export type PolicyLifecycleFacts = {
  policyHash: string;
  activePolicyHash: string | null;
  hasSimulation: boolean;
  hasGuardrailCheck: boolean;
  hasApproval: boolean;
  hasPromotion: boolean;
  supersededByActive: boolean;
};

const EVENT_ORDER: Record<PolicyLifecycleEventType, number> = {
  simulation: 1,
  guardrail_check: 2,
  approval: 3,
  promotion: 4,
  rollback: 5
};

const FALLBACK_ACTOR = "system";

function normalizeTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0).toISOString();
  }
  return parsed.toISOString();
}

function eventSortKey(event: PolicyLifecycleEvent) {
  const parsed = new Date(event.timestamp).getTime();
  return {
    timestamp: Number.isNaN(parsed) ? 0 : parsed,
    order: EVENT_ORDER[event.type] ?? 99,
    actor: event.actor,
    rationale: event.rationale
  };
}

export function derivePolicyLifecycleState(facts: PolicyLifecycleFacts): PolicyLifecycleState {
  if (facts.activePolicyHash && facts.activePolicyHash === facts.policyHash) {
    return PolicyLifecycleState.ACTIVE;
  }
  if (facts.supersededByActive) {
    return PolicyLifecycleState.SUPERSEDED;
  }
  if (facts.hasApproval || facts.hasPromotion) {
    return PolicyLifecycleState.APPROVED;
  }
  if (facts.hasGuardrailCheck) {
    return PolicyLifecycleState.GUARDED;
  }
  if (facts.hasSimulation) {
    return PolicyLifecycleState.SIMULATED;
  }
  return PolicyLifecycleState.DRAFT;
}

export function buildPolicyLifecycleTimeline(input: {
  policyHash: string;
  activePolicyHash: string | null;
  lineage: PolicyLineageRecord | null;
  activeLineageChain: PolicyLineageRecord[];
  simulations: ReplayRunRecord[];
  guardrailChecks: GuardrailCheckRecord[];
  approvals: PolicyApprovalRecord[];
  rollbacks?: RollbackEvent[];
}): PolicyLifecycleTimeline {
  const events: PolicyLifecycleEvent[] = [];

  input.simulations.forEach((run) => {
    events.push({
      type: "simulation",
      timestamp: normalizeTimestamp(run.createdAt),
      actor: run.requestedBy ?? FALLBACK_ACTOR,
      rationale: `Replay run ${run.id}`
    });
  });

  input.guardrailChecks.forEach((check) => {
    events.push({
      type: "guardrail_check",
      timestamp: normalizeTimestamp(check.evaluatedAt),
      actor: check.actor || FALLBACK_ACTOR,
      rationale: check.rationale
    });
  });

  input.approvals.forEach((approval) => {
    events.push({
      type: "approval",
      timestamp: normalizeTimestamp(approval.approvedAt),
      actor: approval.approvedBy,
      rationale: approval.rationale
    });
  });

  if (input.lineage) {
    events.push({
      type: "promotion",
      timestamp: normalizeTimestamp(input.lineage.promotedAt),
      actor: input.lineage.promotedBy,
      rationale: input.lineage.rationale
    });
  }

  input.rollbacks?.forEach((rollback) => {
    events.push({
      type: "rollback",
      timestamp: normalizeTimestamp(rollback.createdAt),
      actor: rollback.actor,
      rationale: rollback.rationale
    });
  });

  const supersededByActive =
    Boolean(input.activePolicyHash) &&
    input.activePolicyHash !== input.policyHash &&
    input.activeLineageChain.some((record) => record.policyHash === input.policyHash);

  const state = derivePolicyLifecycleState({
    policyHash: input.policyHash,
    activePolicyHash: input.activePolicyHash,
    hasSimulation: input.simulations.length > 0,
    hasGuardrailCheck: input.guardrailChecks.length > 0,
    hasApproval: input.approvals.length > 0,
    hasPromotion: Boolean(input.lineage),
    supersededByActive
  });

  const sorted = events.sort((a, b) => {
    const left = eventSortKey(a);
    const right = eventSortKey(b);
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    if (left.actor !== right.actor) {
      return left.actor.localeCompare(right.actor);
    }
    return left.rationale.localeCompare(right.rationale);
  });

  return {
    state,
    events: sorted
  };
}

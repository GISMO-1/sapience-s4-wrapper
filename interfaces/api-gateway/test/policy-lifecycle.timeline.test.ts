import { expect, test } from "vitest";
import type { PolicyLineageRecord } from "../src/policy-lineage/types";
import type { ReplayRunRecord } from "../src/policy-replay/types";
import type { GuardrailCheckRecord } from "../src/policy-promotion-guardrails/types";
import type { PolicyApprovalRecord } from "../src/policy-approvals/types";
import type { RollbackEvent } from "../src/policy-rollback/types";
import {
  PolicyLifecycleState,
  buildPolicyLifecycleTimeline,
  derivePolicyLifecycleState
} from "../src/policy-lifecycle/timeline";

const baseLineage: PolicyLineageRecord = {
  policyHash: "policy-1",
  parentPolicyHash: "policy-0",
  promotedBy: "Reviewer",
  promotedAt: "2024-02-01T12:00:00Z",
  rationale: "Promotion approved.",
  acceptedRiskScore: 10,
  source: "manual",
  drift: {
    constraintsAdded: 1,
    constraintsRemoved: 0,
    severityDelta: 0,
    netRiskScoreChange: 0
  }
};

const baseSimulation: ReplayRunRecord = {
  id: "run-1",
  requestedBy: "analyst",
  baselinePolicyHash: "base",
  candidatePolicyHash: "policy-1",
  candidatePolicySource: "current",
  candidatePolicyRef: null,
  intentTypeFilter: null,
  since: null,
  until: null,
  limit: 50,
  createdAt: new Date("2024-02-01T10:00:00Z")
};

const baseGuardrailDecision = {
  allowed: true,
  requiredAcceptance: false,
  reasons: [],
  snapshot: {
    policyHash: "policy-1",
    evaluatedAt: "2024-02-01T11:00:00Z",
    drift: {
      policyHash: "policy-1",
      baseline: { window: { since: "", until: "" }, metrics: { totalOutcomes: 0, failureRate: 0, overrideRate: 0, qualityScore: 0, replayAdded: 0, replayRemoved: 0 } },
      recent: { window: { since: "", until: "" }, metrics: { totalOutcomes: 0, failureRate: 0, overrideRate: 0, qualityScore: 0, replayAdded: 0, replayRemoved: 0 } },
      deltas: { failureRateDelta: 0, overrideRateDelta: 0, qualityScoreDelta: 0, replayDelta: 0 },
      health: { state: "HEALTHY", rationale: [] }
    },
    impact: {
      policyHashCurrent: "base",
      policyHashCandidate: "policy-1",
      window: { since: "", until: "" },
      totals: { intentsEvaluated: 0, newlyBlocked: 0, newlyAllowed: 0, approvalEscalations: 0, severityIncreases: 0 },
      blastRadiusScore: 0,
      rows: [],
      impactedIntents: 0
    },
    quality: {
      totalOutcomes: 0,
      failureRate: 0,
      overrideRate: 0,
      weightedPenalty: 0,
      qualityScore: 0,
      score: 0
    },
    lineageHead: null
  }
};

const baseGuardrailCheck: GuardrailCheckRecord = {
  id: "check-1",
  createdAt: "2024-02-01T11:00:10Z",
  policyHash: "policy-1",
  evaluatedAt: "2024-02-01T11:00:00Z",
  actor: "Reviewer",
  rationale: "Guardrails clean.",
  decision: baseGuardrailDecision
};

const baseApproval: PolicyApprovalRecord = {
  id: "approval-1",
  createdAt: "2024-02-01T11:30:00Z",
  policyHash: "policy-1",
  approvedBy: "Reviewer",
  approvedAt: "2024-02-01T11:30:00Z",
  rationale: "Approval recorded.",
  acceptedRiskScore: 10,
  notes: null,
  runId: "run-1"
};

const baseRollback: RollbackEvent = {
  eventType: "ROLLBACK",
  eventHash: "rollback-1",
  fromPolicyHash: "policy-2",
  toPolicyHash: "policy-1",
  actor: "SRE",
  rationale: "Rollback after incident.",
  createdAt: "2024-02-01T13:00:00Z"
};

test("state derivation is deterministic", () => {
  const facts = {
    policyHash: "policy-1",
    activePolicyHash: "policy-2",
    hasSimulation: true,
    hasGuardrailCheck: true,
    hasApproval: true,
    hasPromotion: true,
    supersededByActive: false
  };

  const first = derivePolicyLifecycleState(facts);
  const second = derivePolicyLifecycleState({ ...facts });

  expect(first).toBe(PolicyLifecycleState.APPROVED);
  expect(second).toBe(first);
});

test("no state is stored directly", () => {
  const approvalsWithState = [
    { ...baseApproval, state: "ACTIVE" } as PolicyApprovalRecord & { state: string }
  ];
  const approvalsWithOtherState = [
    { ...baseApproval, state: "DRAFT" } as PolicyApprovalRecord & { state: string }
  ];

  const timelineA = buildPolicyLifecycleTimeline({
    policyHash: "policy-1",
    activePolicyHash: "policy-2",
    lineage: baseLineage,
    activeLineageChain: [],
    simulations: [baseSimulation],
    guardrailChecks: [baseGuardrailCheck],
    approvals: approvalsWithState
  });

  const timelineB = buildPolicyLifecycleTimeline({
    policyHash: "policy-1",
    activePolicyHash: "policy-2",
    lineage: baseLineage,
    activeLineageChain: [],
    simulations: [baseSimulation],
    guardrailChecks: [baseGuardrailCheck],
    approvals: approvalsWithOtherState
  });

  expect(timelineA.state).toBe(PolicyLifecycleState.APPROVED);
  expect(timelineA).toEqual(timelineB);
});

test("replaying the same inputs yields identical timelines", () => {
  const timelineA = buildPolicyLifecycleTimeline({
    policyHash: "policy-1",
    activePolicyHash: "policy-1",
    lineage: baseLineage,
    activeLineageChain: [baseLineage],
    simulations: [baseSimulation],
    guardrailChecks: [baseGuardrailCheck],
    approvals: [baseApproval],
    rollbacks: [baseRollback]
  });

  const timelineB = buildPolicyLifecycleTimeline({
    policyHash: "policy-1",
    activePolicyHash: "policy-1",
    lineage: baseLineage,
    activeLineageChain: [baseLineage],
    simulations: [{ ...baseSimulation, id: "run-1" }],
    guardrailChecks: [{ ...baseGuardrailCheck, id: "check-1" }],
    approvals: [{ ...baseApproval, id: "approval-1" }],
    rollbacks: [{ ...baseRollback, eventHash: "rollback-1" }]
  });

  expect(timelineA).toEqual(timelineB);
});

test("rollback events appear in the lifecycle timeline", () => {
  const timeline = buildPolicyLifecycleTimeline({
    policyHash: "policy-1",
    activePolicyHash: "policy-1",
    lineage: baseLineage,
    activeLineageChain: [baseLineage],
    simulations: [baseSimulation],
    guardrailChecks: [baseGuardrailCheck],
    approvals: [baseApproval],
    rollbacks: [baseRollback]
  });

  expect(timeline.events.some((event) => event.type === "rollback")).toBe(true);
});

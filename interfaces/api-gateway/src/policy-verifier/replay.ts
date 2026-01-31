import type {
  PolicyEvent,
  PolicyApprovalRecordedEvent,
  PolicyGuardrailCheckEvent,
  PolicyOutcomeRecordedEvent,
  PolicyPromotedEvent,
  PolicyReplayResultRecordedEvent,
  PolicyReplayRunStartedEvent
} from "../policy-events/types";
import type { PolicyOutcomeRecord } from "../policy-outcomes/types";
import type { ReplayResultRecord, ReplayRunRecord } from "../policy-replay/types";
import type { GuardrailCheckRecord } from "../policy-promotion-guardrails/types";
import type { PolicyApprovalRecord } from "../policy-approvals/types";
import type { PolicyLineageRecord } from "../policy-lineage/types";
import { buildPolicyLifecycleTimeline } from "../policy-lifecycle/timeline";
import { calculatePolicyQuality } from "../policy-quality/score";
import { buildPolicyDriftSummary } from "../policy-lineage/drift";
import { computePolicyDriftReport } from "../policy-drift/compute";
import type { DerivedSnapshot } from "./types";

export type ReplayWindow = { since: Date; until: Date };

export type ReplayEventLogInput = {
  policyHash: string;
  events: PolicyEvent[];
  drift?: { recent: ReplayWindow; baseline: ReplayWindow };
  quality?: ReplayWindow;
};

const sortEvents = (a: PolicyEvent, b: PolicyEvent) => {
  const timeDiff = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }
  if (a.kind !== b.kind) {
    return a.kind.localeCompare(b.kind);
  }
  return a.eventId.localeCompare(b.eventId);
};

function inWindow(date: Date, window?: ReplayWindow): boolean {
  if (!window) {
    return true;
  }
  return date >= window.since && date <= window.until;
}

function buildReplayRuns(events: PolicyEvent[]): ReplayRunRecord[] {
  return events
    .filter((event): event is PolicyReplayRunStartedEvent => event.kind === "POLICY_REPLAY_RUN_STARTED")
    .map((event) => ({
      id: event.payload.runId,
      requestedBy: event.actor ?? null,
      baselinePolicyHash: event.payload.baselinePolicyHash,
      candidatePolicyHash: event.payload.candidatePolicyHash,
      candidatePolicySource: event.payload.candidatePolicySource,
      candidatePolicyRef: event.payload.candidatePolicyRef ?? null,
      intentTypeFilter: event.payload.intentTypeFilter ?? null,
      since: event.payload.since ? new Date(event.payload.since) : null,
      until: event.payload.until ? new Date(event.payload.until) : null,
      limit: event.payload.limit,
      createdAt: new Date(event.occurredAt)
    }));
}

function buildReplayResults(events: PolicyEvent[]): ReplayResultRecord[] {
  return events
    .filter((event): event is PolicyReplayResultRecordedEvent => event.kind === "POLICY_REPLAY_RESULT_RECORDED")
    .map((event) => ({
      id: event.payload.resultId,
      runId: event.payload.runId,
      traceId: event.payload.traceId,
      intentType: event.payload.intentType,
      baselineDecision: event.payload.baselineDecision,
      candidateDecision: event.payload.candidateDecision,
      changed: event.payload.changed,
      baselinePolicyHash: event.payload.baselinePolicyHash,
      candidatePolicyHash: event.payload.candidatePolicyHash,
      baselineMatchedRules: event.payload.baselineMatchedRules,
      candidateMatchedRules: event.payload.candidateMatchedRules,
      candidateConstraintTypes: event.payload.candidateConstraintTypes ?? [],
      baselineRisk: event.payload.baselineRisk,
      reasons: [],
      categories: [],
      risk: event.payload.risk,
      createdAt: new Date(event.occurredAt)
    }));
}

function buildOutcomes(events: PolicyEvent[], policyHash: string): PolicyOutcomeRecord[] {
  return events
    .filter((event): event is PolicyOutcomeRecordedEvent => event.kind === "POLICY_OUTCOME_RECORDED")
    .map((event) => ({
      id: event.payload.outcomeId,
      traceId: event.payload.traceId,
      intentType: event.payload.intentType,
      policyHash: policyHash,
      decision: event.payload.decision,
      outcomeType: event.payload.outcomeType,
      severity: event.payload.severity,
      humanOverride: event.payload.humanOverride,
      notes: event.payload.notes ?? null,
      observedAt: new Date(event.occurredAt),
      createdAt: new Date(event.occurredAt)
    }));
}

function buildGuardrailChecks(events: PolicyEvent[], policyHash: string): GuardrailCheckRecord[] {
  return events
    .filter((event): event is PolicyGuardrailCheckEvent => event.kind === "POLICY_PROMOTION_GUARDRAIL_CHECKED")
    .map((event) => ({
      id: event.payload.checkId,
      policyHash,
      evaluatedAt: event.occurredAt,
      actor: event.payload.actor,
      rationale: event.payload.rationale,
      decision: event.payload.decision,
      createdAt: event.occurredAt
    }));
}

function buildApprovals(events: PolicyEvent[], policyHash: string): PolicyApprovalRecord[] {
  return events
    .filter((event): event is PolicyApprovalRecordedEvent => event.kind === "POLICY_APPROVAL_RECORDED")
    .map((event) => ({
      id: event.payload.approvalId,
      policyHash,
      approvedBy: event.payload.approvedBy,
      approvedAt: event.payload.approvedAt,
      rationale: event.payload.rationale,
      acceptedRiskScore: event.payload.acceptedRiskScore,
      notes: event.payload.notes,
      runId: event.payload.runId,
      createdAt: event.occurredAt
    }));
}

function buildLineage(events: PolicyEvent[], policyHash: string): PolicyLineageRecord | null {
  const promotions = events
    .filter((event): event is PolicyPromotedEvent => event.kind === "POLICY_PROMOTED")
    .map((event) => ({
      policyHash,
      parentPolicyHash: event.payload.parentPolicyHash,
      promotedBy: event.payload.promotedBy,
      promotedAt: event.occurredAt,
      rationale: event.payload.rationale,
      acceptedRiskScore: event.payload.acceptedRiskScore,
      source: event.payload.source,
      drift: event.payload.drift
    }));

  if (!promotions.length) {
    return null;
  }
  promotions.sort((a, b) => a.promotedAt.localeCompare(b.promotedAt));
  return promotions[promotions.length - 1];
}

function computeReplayDrift(input: {
  policyHash: string;
  runs: ReplayRunRecord[];
  results: ReplayResultRecord[];
  outcomes: PolicyOutcomeRecord[];
  windows: { recent: ReplayWindow; baseline: ReplayWindow };
}) {
  const resultsByRun = new Map<string, ReplayResultRecord[]>();
  input.results.forEach((result) => {
    const list = resultsByRun.get(result.runId) ?? [];
    list.push(result);
    resultsByRun.set(result.runId, list);
  });

  const calculateReplayCounts = (window: ReplayWindow) => {
    let added = 0;
    let removed = 0;
    input.runs
      .filter((run) => inWindow(run.createdAt, window))
      .forEach((run) => {
        const results = resultsByRun.get(run.id) ?? [];
        if (!results.length) {
          return;
        }
        const drift = buildPolicyDriftSummary(results);
        added += drift.constraintsAdded;
        removed += drift.constraintsRemoved;
      });
    return { added, removed };
  };

  const recentOutcomes = input.outcomes.filter((outcome) => inWindow(outcome.observedAt, input.windows.recent));
  const baselineOutcomes = input.outcomes.filter((outcome) => inWindow(outcome.observedAt, input.windows.baseline));
  const recentReplay = calculateReplayCounts(input.windows.recent);
  const baselineReplay = calculateReplayCounts(input.windows.baseline);

  return computePolicyDriftReport({
    policyHash: input.policyHash,
    recent: {
      window: input.windows.recent,
      outcomes: recentOutcomes,
      replayAdded: recentReplay.added,
      replayRemoved: recentReplay.removed
    },
    baseline: {
      window: input.windows.baseline,
      outcomes: baselineOutcomes,
      replayAdded: baselineReplay.added,
      replayRemoved: baselineReplay.removed
    }
  });
}

export function replayEventLog(input: ReplayEventLogInput): DerivedSnapshot {
  const events = input.events.slice().sort(sortEvents);
  const runs = buildReplayRuns(events);
  const results = buildReplayResults(events);
  const outcomes = buildOutcomes(events, input.policyHash);
  const guardrailChecks = buildGuardrailChecks(events, input.policyHash);
  const approvals = buildApprovals(events, input.policyHash);
  const lineage = buildLineage(events, input.policyHash);
  const guardrailDecision = guardrailChecks.length
    ? guardrailChecks.slice().sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt)).at(-1)?.decision ?? null
    : null;
  const activePolicyHash = lineage ? input.policyHash : null;
  const lifecycle = buildPolicyLifecycleTimeline({
    policyHash: input.policyHash,
    activePolicyHash,
    lineage,
    activeLineageChain: lineage ? [lineage] : [],
    simulations: runs,
    guardrailChecks,
    approvals
  });

  const qualityWindow = input.quality;
  const qualityOutcomes = qualityWindow
    ? outcomes.filter((outcome) => inWindow(outcome.observedAt, qualityWindow))
    : outcomes;
  const quality = calculatePolicyQuality(qualityOutcomes);

  const driftReport = input.drift
    ? computeReplayDrift({
        policyHash: input.policyHash,
        runs,
        results,
        outcomes,
        windows: input.drift
      })
    : null;

  return {
    policyHash: input.policyHash,
    activePolicyHash,
    lifecycle,
    lineage,
    driftReport,
    quality,
    guardrailDecision
  };
}

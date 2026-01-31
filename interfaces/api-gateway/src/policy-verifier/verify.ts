import type { PolicyEvent } from "../policy-events/types";
import { buildPolicyEventLog } from "../policy-events/projector";
import { canonicalJson } from "../policy-events/hash";
import { buildPolicyLifecycleTimeline } from "../policy-lifecycle/timeline";
import { calculatePolicyQuality } from "../policy-quality/score";
import { buildPolicyDriftReport, defaultDriftWindow } from "../policy-drift/compute";
import type { DriftReport } from "../policy-drift/types";
import type { PolicyQualityMetrics } from "../policy-quality/types";
import type { PolicyLineageRecord } from "../policy-lineage/types";
import type { GuardrailDecision } from "../policy-promotion-guardrails/types";
import { createPolicyOutcomeStore } from "../policy-outcomes/store";
import { createPolicyReplayStore } from "../policy-replay/replay-store";
import { createPolicyLineageStore } from "../policy-lineage/store";
import { createPolicyGuardrailCheckStore } from "../policy-promotion-guardrails/store";
import { createPolicyApprovalStore } from "../policy-approvals/store";
import type { PolicyOutcomeStore } from "../policy-outcomes/store";
import type { PolicyReplayStore } from "../policy-replay/replay-store";
import type { PolicyLineageStore } from "../policy-lineage/store";
import type { GuardrailCheckStore } from "../policy-promotion-guardrails/store";
import type { PolicyApprovalStore } from "../policy-approvals/store";
import { replayEventLog, type ReplayWindow } from "./replay";
import type { DerivedSnapshot, VerificationMismatch } from "./types";

export type VerifyInput = {
  policyHash: string;
  since?: Date;
  until?: Date;
  baselineSince?: Date;
  baselineUntil?: Date;
  qualitySince?: Date;
  qualityUntil?: Date;
  limit?: number;
  now?: Date;
  activePolicyHash?: string | null;
  stores?: {
    replayStore?: PolicyReplayStore;
    outcomeStore?: PolicyOutcomeStore;
    lineageStore?: PolicyLineageStore;
    guardrailCheckStore?: GuardrailCheckStore;
    approvalStore?: PolicyApprovalStore;
  };
  events?: PolicyEvent[];
};

const MAX_MISMATCHES = 25;
const RATE_DECIMALS = 4;

function roundNumber(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return value;
  }
  return Number(value.toFixed(RATE_DECIMALS));
}

function normalizeQuality(metrics: PolicyQualityMetrics): PolicyQualityMetrics {
  return {
    totalOutcomes: metrics.totalOutcomes,
    failureRate: roundNumber(metrics.failureRate) ?? 0,
    overrideRate: roundNumber(metrics.overrideRate) ?? 0,
    weightedPenalty: roundNumber(metrics.weightedPenalty) ?? 0,
    qualityScore: roundNumber(metrics.qualityScore) ?? 0
  };
}

function normalizeLineage(lineage: PolicyLineageRecord | null): PolicyLineageRecord | null {
  if (!lineage) {
    return null;
  }
  return {
    ...lineage,
    acceptedRiskScore: roundNumber(lineage.acceptedRiskScore) ?? 0,
    drift: {
      constraintsAdded: lineage.drift.constraintsAdded,
      constraintsRemoved: lineage.drift.constraintsRemoved,
      severityDelta: roundNumber(lineage.drift.severityDelta) ?? 0,
      netRiskScoreChange: roundNumber(lineage.drift.netRiskScoreChange) ?? 0
    }
  };
}

function normalizeDriftReport(report: DriftReport | null): DriftReport | null {
  if (!report) {
    return null;
  }
  return {
    ...report,
    recent: {
      ...report.recent,
      metrics: {
        ...report.recent.metrics,
        failureRate: roundNumber(report.recent.metrics.failureRate) ?? 0,
        overrideRate: roundNumber(report.recent.metrics.overrideRate) ?? 0,
        qualityScore: roundNumber(report.recent.metrics.qualityScore) ?? 0
      }
    },
    baseline: {
      ...report.baseline,
      metrics: {
        ...report.baseline.metrics,
        failureRate: roundNumber(report.baseline.metrics.failureRate) ?? 0,
        overrideRate: roundNumber(report.baseline.metrics.overrideRate) ?? 0,
        qualityScore: roundNumber(report.baseline.metrics.qualityScore) ?? 0
      }
    },
    deltas: {
      ...report.deltas,
      failureRateDelta: roundNumber(report.deltas.failureRateDelta) ?? 0,
      overrideRateDelta: roundNumber(report.deltas.overrideRateDelta) ?? 0,
      qualityScoreDelta: roundNumber(report.deltas.qualityScoreDelta) ?? 0
    },
    health: {
      ...report.health,
      rationale: report.health.rationale.slice().sort((a, b) => a.localeCompare(b))
    }
  };
}

function normalizeLifecycle(timeline: DerivedSnapshot["lifecycle"]): DerivedSnapshot["lifecycle"] {
  return {
    state: timeline.state,
    events: timeline.events
      .slice()
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
          return a.timestamp.localeCompare(b.timestamp);
        }
        if (a.type !== b.type) {
          return a.type.localeCompare(b.type);
        }
        if (a.actor !== b.actor) {
          return a.actor.localeCompare(b.actor);
        }
        return a.rationale.localeCompare(b.rationale);
      })
  };
}

function normalizeGuardrailDecision(decision: GuardrailDecision | null): GuardrailDecision | null {
  if (!decision) {
    return null;
  }
  const reasons = decision.reasons.slice().sort((a, b) => a.code.localeCompare(b.code));
  const impactRows = decision.snapshot.impact.rows
    .slice()
    .map((row) => ({
      ...row,
      prevApprovalsRequired: row.prevApprovalsRequired.slice().sort(),
      nextApprovalsRequired: row.nextApprovalsRequired.slice().sort(),
      classifications: row.classifications.slice().sort()
    }))
    .sort((a, b) => a.traceId.localeCompare(b.traceId));

  return {
    ...decision,
    reasons,
    snapshot: {
      ...decision.snapshot,
      drift: normalizeDriftReport(decision.snapshot.drift) as DriftReport,
      impact: {
        ...decision.snapshot.impact,
        blastRadiusScore: roundNumber(decision.snapshot.impact.blastRadiusScore) ?? 0,
        totals: {
          ...decision.snapshot.impact.totals
        },
        rows: impactRows
      },
      quality: {
        ...decision.snapshot.quality,
        failureRate: roundNumber(decision.snapshot.quality.failureRate) ?? 0,
        overrideRate: roundNumber(decision.snapshot.quality.overrideRate) ?? 0,
        weightedPenalty: roundNumber(decision.snapshot.quality.weightedPenalty) ?? 0,
        qualityScore: roundNumber(decision.snapshot.quality.qualityScore) ?? 0,
        score: roundNumber(decision.snapshot.quality.score) ?? 0
      }
    }
  };
}

function compareField(
  mismatches: VerificationMismatch[],
  field: string,
  expected: unknown,
  actual: unknown
) {
  if (mismatches.length >= MAX_MISMATCHES) {
    return;
  }
  const expectedJson = canonicalJson(expected);
  const actualJson = canonicalJson(actual);
  if (expectedJson !== actualJson) {
    mismatches.push({ field, expected, actual });
  }
}

function resolveWindow(now: Date, since?: Date, until?: Date): ReplayWindow {
  const resolvedUntil = until ?? now;
  const resolvedSince = since ?? new Date(0);
  return { since: resolvedSince, until: resolvedUntil };
}

function resolveDriftWindows(input: {
  now: Date;
  since?: Date;
  until?: Date;
  baselineSince?: Date;
  baselineUntil?: Date;
}): { recent: ReplayWindow; baseline: ReplayWindow } {
  if (input.since && input.until && input.baselineSince && input.baselineUntil) {
    return {
      recent: { since: input.since, until: input.until },
      baseline: { since: input.baselineSince, until: input.baselineUntil }
    };
  }
  const defaults = defaultDriftWindow(input.now);
  return {
    recent: {
      since: input.since ?? defaults.recent.since,
      until: input.until ?? defaults.recent.until
    },
    baseline: {
      since: input.baselineSince ?? defaults.baseline.since,
      until: input.baselineUntil ?? defaults.baseline.until
    }
  };
}

async function buildLiveSnapshot(input: {
  policyHash: string;
  activePolicyHash: string | null;
  drift: { recent: ReplayWindow; baseline: ReplayWindow };
  quality?: ReplayWindow;
  stores: {
    replayStore: PolicyReplayStore;
    outcomeStore: PolicyOutcomeStore;
    lineageStore: PolicyLineageStore;
    guardrailCheckStore: GuardrailCheckStore;
    approvalStore: PolicyApprovalStore;
  };
}): Promise<DerivedSnapshot> {
  const { policyHash } = input;
  const [lineage, activeLineageChain, simulations, guardrailChecks, approvals] = await Promise.all([
    input.stores.lineageStore.getLineage(policyHash),
    input.activePolicyHash ? input.stores.lineageStore.getLineageChain(input.activePolicyHash) : Promise.resolve([]),
    input.stores.replayStore.listRuns({ policyHash, limit: 200 }),
    input.stores.guardrailCheckStore.listChecks(policyHash),
    input.stores.approvalStore.listApprovals(policyHash)
  ]);

  const lifecycle = buildPolicyLifecycleTimeline({
    policyHash,
    activePolicyHash: input.activePolicyHash,
    lineage,
    activeLineageChain,
    simulations,
    guardrailChecks,
    approvals
  });

  const outcomes = await input.stores.outcomeStore.listOutcomes({
    policyHash,
    since: input.quality?.since,
    until: input.quality?.until
  });
  const quality = calculatePolicyQuality(outcomes);
  const driftReport = await buildPolicyDriftReport({
    policyHash,
    recentWindow: input.drift.recent,
    baselineWindow: input.drift.baseline,
    outcomeStore: input.stores.outcomeStore,
    replayStore: input.stores.replayStore,
    lineageStore: input.stores.lineageStore
  });
  const guardrailDecision = guardrailChecks
    .slice()
    .sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt))
    .at(-1)?.decision ?? null;

  return {
    policyHash,
    activePolicyHash: input.activePolicyHash,
    lifecycle,
    lineage,
    driftReport,
    quality,
    guardrailDecision
  };
}

export async function verifyPolicyDeterminism(input: VerifyInput) {
  const now = input.now ?? new Date();
  const driftWindows = resolveDriftWindows({
    now,
    since: input.since,
    until: input.until,
    baselineSince: input.baselineSince,
    baselineUntil: input.baselineUntil
  });
  const qualityWindow =
    input.qualitySince || input.qualityUntil
      ? resolveWindow(now, input.qualitySince, input.qualityUntil)
      : undefined;

  const events = input.events ??
    (await buildPolicyEventLog({
      policyHash: input.policyHash,
      since: input.since,
      until: input.until,
      limit: input.limit
    }));

  const replaySnapshot = replayEventLog({
    policyHash: input.policyHash,
    events,
    drift: driftWindows,
    quality: qualityWindow
  });

  const replayStore = input.stores?.replayStore ?? createPolicyReplayStore();
  const outcomeStore = input.stores?.outcomeStore ?? createPolicyOutcomeStore();
  const lineageStore = input.stores?.lineageStore ?? createPolicyLineageStore();
  const guardrailCheckStore = input.stores?.guardrailCheckStore ?? createPolicyGuardrailCheckStore();
  const approvalStore = input.stores?.approvalStore ?? createPolicyApprovalStore();

  const liveSnapshot = await buildLiveSnapshot({
    policyHash: input.policyHash,
    activePolicyHash: input.activePolicyHash ?? null,
    drift: driftWindows,
    quality: qualityWindow,
    stores: {
      replayStore,
      outcomeStore,
      lineageStore,
      guardrailCheckStore,
      approvalStore
    }
  });

  const mismatches: VerificationMismatch[] = [];

  compareField(mismatches, "activePolicyHash", replaySnapshot.activePolicyHash, liveSnapshot.activePolicyHash);
  compareField(mismatches, "lifecycle", normalizeLifecycle(replaySnapshot.lifecycle), normalizeLifecycle(liveSnapshot.lifecycle));
  compareField(mismatches, "lineage", normalizeLineage(replaySnapshot.lineage), normalizeLineage(liveSnapshot.lineage));
  compareField(mismatches, "quality", normalizeQuality(replaySnapshot.quality), normalizeQuality(liveSnapshot.quality));
  compareField(
    mismatches,
    "driftReport",
    normalizeDriftReport(replaySnapshot.driftReport),
    normalizeDriftReport(liveSnapshot.driftReport)
  );
  compareField(
    mismatches,
    "guardrailDecision",
    normalizeGuardrailDecision(replaySnapshot.guardrailDecision),
    normalizeGuardrailDecision(liveSnapshot.guardrailDecision)
  );

  return {
    verified: mismatches.length === 0,
    mismatches,
    eventCount: events.length,
    lastEventHash: events.length ? events[events.length - 1].eventHash : null,
    windows: {
      drift: {
        recent: {
          since: driftWindows.recent.since.toISOString(),
          until: driftWindows.recent.until.toISOString()
        },
        baseline: {
          since: driftWindows.baseline.since.toISOString(),
          until: driftWindows.baseline.until.toISOString()
        }
      },
      quality: qualityWindow
        ? { since: qualityWindow.since.toISOString(), until: qualityWindow.until.toISOString() }
        : null
    }
  };
}

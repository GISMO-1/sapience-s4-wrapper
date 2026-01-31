import type { PolicyLineageStore } from "../policy-lineage/store";
import { buildPolicyDriftSummary } from "../policy-lineage/drift";
import type { PolicyOutcomeStore } from "../policy-outcomes/store";
import type { PolicyOutcomeRecord } from "../policy-outcomes/types";
import type { PolicyReplayStore } from "../policy-replay/replay-store";
import { calculatePolicyQuality } from "../policy-quality/score";
import type { DriftReport, DriftWindow, DriftMetrics, DriftDeltas, HealthState } from "./types";

const RATE_DECIMALS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

type DriftWindowInput = {
  window: { since: Date; until: Date };
  outcomes: PolicyOutcomeRecord[];
  replayAdded: number;
  replayRemoved: number;
};

type ReplayCounts = { added: number; removed: number };

function roundRate(value: number, decimals = RATE_DECIMALS): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(decimals));
}

function formatWindow(window: { since: Date; until: Date }): DriftWindow {
  return {
    since: window.since.toISOString(),
    until: window.until.toISOString()
  };
}

function buildMetrics(input: DriftWindowInput): DriftMetrics {
  const quality = calculatePolicyQuality(input.outcomes);
  return {
    totalOutcomes: quality.totalOutcomes,
    failureRate: roundRate(quality.failureRate),
    overrideRate: roundRate(quality.overrideRate),
    qualityScore: roundRate(quality.qualityScore),
    replayAdded: input.replayAdded,
    replayRemoved: input.replayRemoved
  };
}

function buildDeltas(recent: DriftMetrics, baseline: DriftMetrics): DriftDeltas {
  const recentReplay = recent.replayAdded + recent.replayRemoved;
  const baselineReplay = baseline.replayAdded + baseline.replayRemoved;
  return {
    failureRateDelta: roundRate(recent.failureRate - baseline.failureRate),
    overrideRateDelta: roundRate(recent.overrideRate - baseline.overrideRate),
    qualityScoreDelta: roundRate(recent.qualityScore - baseline.qualityScore),
    replayDelta: recentReplay - baselineReplay
  };
}

function buildHealth(metrics: DriftMetrics, deltas: DriftDeltas): DriftReport["health"] {
  const critical: string[] = [];
  const degraded: string[] = [];
  const watch: string[] = [];

  if (metrics.qualityScore < 60) {
    critical.push(`qualityScore < 60 (${metrics.qualityScore.toFixed(RATE_DECIMALS)})`);
  } else if (metrics.qualityScore < 80) {
    degraded.push(`qualityScore < 80 (${metrics.qualityScore.toFixed(RATE_DECIMALS)})`);
  }

  if (metrics.failureRate > 0.2) {
    critical.push(`failureRate > 0.20 (${metrics.failureRate.toFixed(RATE_DECIMALS)})`);
  } else if (metrics.failureRate > 0.1) {
    degraded.push(`failureRate > 0.10 (${metrics.failureRate.toFixed(RATE_DECIMALS)})`);
  }

  if (metrics.overrideRate > 0.2) {
    critical.push(`overrideRate > 0.20 (${metrics.overrideRate.toFixed(RATE_DECIMALS)})`);
  } else if (metrics.overrideRate > 0.1) {
    degraded.push(`overrideRate > 0.10 (${metrics.overrideRate.toFixed(RATE_DECIMALS)})`);
  }

  if (deltas.replayDelta >= 50) {
    critical.push(`replayDelta >= 50 (${deltas.replayDelta})`);
  } else if (deltas.replayDelta >= 25) {
    degraded.push(`replayDelta >= 25 (${deltas.replayDelta})`);
  } else if (deltas.replayDelta >= 10) {
    watch.push(`replayDelta >= 10 (${deltas.replayDelta})`);
  }

  if (deltas.failureRateDelta >= 0.05) {
    watch.push(`failureRateDelta >= 0.05 (${deltas.failureRateDelta.toFixed(RATE_DECIMALS)})`);
  }
  if (deltas.overrideRateDelta >= 0.05) {
    watch.push(`overrideRateDelta >= 0.05 (${deltas.overrideRateDelta.toFixed(RATE_DECIMALS)})`);
  }

  const rationale = [...critical, ...degraded, ...watch];
  let state: HealthState = "HEALTHY";
  if (critical.length) {
    state = "CRITICAL";
  } else if (degraded.length) {
    state = "DEGRADED";
  } else if (watch.length) {
    state = "WATCH";
  }

  return { state, rationale };
}

function isWithinWindow(date: Date, window: { since: Date; until: Date }): boolean {
  return date >= window.since && date <= window.until;
}

async function getReplayCountsFromLineage(
  policyHash: string,
  window: { since: Date; until: Date },
  lineageStore?: PolicyLineageStore
): Promise<ReplayCounts | null> {
  if (!lineageStore) {
    return null;
  }
  const lineage = await lineageStore.getLineage(policyHash);
  if (!lineage || lineage.source !== "replay") {
    return null;
  }
  const promotedAt = new Date(lineage.promotedAt);
  if (!Number.isFinite(promotedAt.getTime()) || !isWithinWindow(promotedAt, window)) {
    return null;
  }
  return {
    added: lineage.drift.constraintsAdded,
    removed: lineage.drift.constraintsRemoved
  };
}

async function getReplayCountsFromRuns(
  policyHash: string,
  window: { since: Date; until: Date },
  replayStore: PolicyReplayStore
): Promise<ReplayCounts> {
  const runs = await replayStore.listRuns({
    policyHash,
    since: window.since,
    until: window.until
  });
  if (!runs.length) {
    return { added: 0, removed: 0 };
  }
  let added = 0;
  let removed = 0;
  for (const run of runs) {
    const results = await replayStore.getResults(run.id, { limit: run.limit, offset: 0 });
    if (!results.length) {
      continue;
    }
    const drift = buildPolicyDriftSummary(results);
    added += drift.constraintsAdded;
    removed += drift.constraintsRemoved;
  }
  return { added, removed };
}

export function computePolicyDriftReport(input: {
  policyHash: string;
  recent: DriftWindowInput;
  baseline: DriftWindowInput;
}): DriftReport {
  const recentMetrics = buildMetrics(input.recent);
  const baselineMetrics = buildMetrics(input.baseline);
  const deltas = buildDeltas(recentMetrics, baselineMetrics);
  const health = buildHealth(recentMetrics, deltas);

  return {
    policyHash: input.policyHash,
    recent: { window: formatWindow(input.recent.window), metrics: recentMetrics },
    baseline: { window: formatWindow(input.baseline.window), metrics: baselineMetrics },
    deltas,
    health
  };
}

export async function buildPolicyDriftReport(input: {
  policyHash: string;
  recentWindow: { since: Date; until: Date };
  baselineWindow: { since: Date; until: Date };
  outcomeStore: PolicyOutcomeStore;
  replayStore: PolicyReplayStore;
  lineageStore?: PolicyLineageStore;
}): Promise<DriftReport> {
  const [recentOutcomes, baselineOutcomes] = await Promise.all([
    input.outcomeStore.listOutcomes({
      policyHash: input.policyHash,
      since: input.recentWindow.since,
      until: input.recentWindow.until
    }),
    input.outcomeStore.listOutcomes({
      policyHash: input.policyHash,
      since: input.baselineWindow.since,
      until: input.baselineWindow.until
    })
  ]);

  const [recentLineage, baselineLineage] = await Promise.all([
    getReplayCountsFromLineage(input.policyHash, input.recentWindow, input.lineageStore),
    getReplayCountsFromLineage(input.policyHash, input.baselineWindow, input.lineageStore)
  ]);

  const recentReplay =
    recentLineage ?? (await getReplayCountsFromRuns(input.policyHash, input.recentWindow, input.replayStore));
  const baselineReplay =
    baselineLineage ?? (await getReplayCountsFromRuns(input.policyHash, input.baselineWindow, input.replayStore));

  return computePolicyDriftReport({
    policyHash: input.policyHash,
    recent: {
      window: input.recentWindow,
      outcomes: recentOutcomes,
      replayAdded: recentReplay.added,
      replayRemoved: recentReplay.removed
    },
    baseline: {
      window: input.baselineWindow,
      outcomes: baselineOutcomes,
      replayAdded: baselineReplay.added,
      replayRemoved: baselineReplay.removed
    }
  });
}

export function defaultDriftWindow(now: Date): { recent: { since: Date; until: Date }; baseline: { since: Date; until: Date } } {
  const recentUntil = new Date(now);
  const recentSince = new Date(recentUntil.getTime() - 7 * DAY_MS);
  const baselineUntil = new Date(recentSince);
  const baselineSince = new Date(baselineUntil.getTime() - 30 * DAY_MS);
  return {
    recent: { since: recentSince, until: recentUntil },
    baseline: { since: baselineSince, until: baselineUntil }
  };
}

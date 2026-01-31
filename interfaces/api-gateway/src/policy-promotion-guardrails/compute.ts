import type { ExecutionMode } from "../policy-code/types";
import type { CandidatePolicySnapshot } from "../policy-code/loader";
import { calculatePolicyQuality } from "../policy-quality/score";
import type { PolicyOutcomeStore } from "../policy-outcomes/store";
import type { PolicyReplayStore } from "../policy-replay/replay-store";
import type { PolicyLineageStore } from "../policy-lineage/store";
import { buildPolicyDriftReport, defaultDriftWindow } from "../policy-drift/compute";
import { computePolicyImpactReport } from "../policy-impact/compute";
import { buildPolicyDriftSummary } from "../policy-lineage/drift";
import type { GuardrailConfig, GuardrailDecision, FailureReason, Thresholds } from "./types";
import type { HealthState } from "../policy-drift/types";

const RATE_DECIMALS = 4;

const HEALTH_ORDER: Record<HealthState, number> = {
  HEALTHY: 0,
  WATCH: 1,
  DEGRADED: 2,
  CRITICAL: 3
};

const FAILURE_ORDER: FailureReason["code"][] = [
  "BLAST_RADIUS_EXCEEDED",
  "IMPACTED_INTENTS_EXCEEDED",
  "SEVERITY_DELTA_EXCEEDED",
  "HEALTH_STATE_TOO_LOW",
  "QUALITY_SCORE_TOO_HIGH"
];

function roundRate(value: number, decimals = RATE_DECIMALS): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(decimals));
}

function summarizeQuality(input: { totalOutcomes: number; failureRate: number; overrideRate: number; weightedPenalty: number; qualityScore: number }) {
  return {
    totalOutcomes: input.totalOutcomes,
    failureRate: roundRate(input.failureRate),
    overrideRate: roundRate(input.overrideRate),
    weightedPenalty: roundRate(input.weightedPenalty),
    qualityScore: roundRate(input.qualityScore)
  };
}

function computeImpactedIntents(rows: Array<{ classifications: string[] }>): number {
  return rows.filter((row) => !(row.classifications.length === 1 && row.classifications[0] === "UNCHANGED")).length;
}

function compareHealthState(state: HealthState, minState: HealthState): boolean {
  return HEALTH_ORDER[state] <= HEALTH_ORDER[minState];
}

function buildReasons(input: {
  thresholds: Thresholds;
  blastRadius: number;
  impactedIntents: number;
  severityDelta: number;
  healthState: HealthState;
  qualityScore: number;
}): FailureReason[] {
  const reasons: FailureReason[] = [];

  if (input.blastRadius > input.thresholds.maxBlastRadius) {
    reasons.push({
      code: "BLAST_RADIUS_EXCEEDED",
      message: "Blast radius score exceeds the promotion limit.",
      metric: roundRate(input.blastRadius),
      threshold: input.thresholds.maxBlastRadius
    });
  }

  if (input.impactedIntents > input.thresholds.maxImpactedIntents) {
    reasons.push({
      code: "IMPACTED_INTENTS_EXCEEDED",
      message: "Impacted intents exceed the promotion limit.",
      metric: input.impactedIntents,
      threshold: input.thresholds.maxImpactedIntents
    });
  }

  if (Math.abs(input.severityDelta) > input.thresholds.maxSeverityDelta) {
    reasons.push({
      code: "SEVERITY_DELTA_EXCEEDED",
      message: "Severity delta exceeds the promotion limit.",
      metric: input.severityDelta,
      threshold: input.thresholds.maxSeverityDelta
    });
  }

  if (!compareHealthState(input.healthState, input.thresholds.minHealthState)) {
    reasons.push({
      code: "HEALTH_STATE_TOO_LOW",
      message: "Policy health state is below the minimum allowed for promotion.",
      metric: input.healthState,
      threshold: input.thresholds.minHealthState
    });
  }

  if (input.qualityScore > input.thresholds.maxQualityScore) {
    reasons.push({
      code: "QUALITY_SCORE_TOO_HIGH",
      message: "Quality score exceeds the promotion limit.",
      metric: roundRate(input.qualityScore),
      threshold: input.thresholds.maxQualityScore
    });
  }

  return reasons.sort((a, b) => FAILURE_ORDER.indexOf(a.code) - FAILURE_ORDER.indexOf(b.code));
}

async function computeLatestSeverityDelta(policyHash: string, replayStore: PolicyReplayStore): Promise<number> {
  const runs = await replayStore.listRuns({ policyHash, limit: 200 });
  if (!runs.length) {
    return 0;
  }
  const latest = runs[runs.length - 1];
  const results = await replayStore.getResults(latest.id, { limit: latest.limit, offset: 0 });
  if (!results.length) {
    return 0;
  }
  return buildPolicyDriftSummary(results).severityDelta;
}

export async function evaluatePromotionGuardrails(input: {
  policyHash: string;
  candidatePolicy: CandidatePolicySnapshot;
  currentPolicy: CandidatePolicySnapshot;
  outcomeStore: PolicyOutcomeStore;
  replayStore: PolicyReplayStore;
  lineageStore?: PolicyLineageStore;
  config: GuardrailConfig;
  executionMode: ExecutionMode;
  now?: Date;
  impactLimit?: number;
}): Promise<GuardrailDecision> {
  const now = input.now ?? new Date();
  const windows = defaultDriftWindow(now);
  const impactWindow = windows.recent;

  const [driftReport, lineageHead, baselineIntents, recentOutcomes, severityDelta] = await Promise.all([
    buildPolicyDriftReport({
      policyHash: input.policyHash,
      recentWindow: windows.recent,
      baselineWindow: windows.baseline,
      outcomeStore: input.outcomeStore,
      replayStore: input.replayStore,
      lineageStore: input.lineageStore
    }),
    input.lineageStore?.getLineage(input.policyHash) ?? Promise.resolve(null),
    input.replayStore.listBaselineIntents({
      since: impactWindow.since,
      until: impactWindow.until,
      limit: input.impactLimit ?? 100
    }),
    input.outcomeStore.listOutcomes({
      policyHash: input.policyHash,
      since: impactWindow.since,
      until: impactWindow.until
    }),
    computeLatestSeverityDelta(input.policyHash, input.replayStore)
  ]);

  const impactReport = computePolicyImpactReport({
    currentPolicy: input.currentPolicy,
    candidatePolicy: input.candidatePolicy,
    intents: baselineIntents,
    window: { since: impactWindow.since, until: impactWindow.until },
    executionMode: input.executionMode
  });

  const impactedIntents = computeImpactedIntents(impactReport.rows);
  const qualityMetrics = calculatePolicyQuality(recentOutcomes);
  const qualitySummary = summarizeQuality(qualityMetrics);
  const qualityScore = roundRate(100 - qualitySummary.qualityScore);

  const reasons = buildReasons({
    thresholds: input.config.thresholds,
    blastRadius: impactReport.blastRadiusScore,
    impactedIntents,
    severityDelta,
    healthState: driftReport.health.state,
    qualityScore
  });

  const allowed = reasons.length === 0;

  return {
    allowed,
    requiredAcceptance: allowed && input.config.requireAcceptedRisk,
    reasons,
    snapshot: {
      policyHash: input.policyHash,
      evaluatedAt: now.toISOString(),
      drift: driftReport,
      impact: {
        ...impactReport,
        blastRadiusScore: roundRate(impactReport.blastRadiusScore),
        impactedIntents
      },
      quality: {
        ...qualitySummary,
        score: qualityScore
      },
      lineageHead: lineageHead ?? null
    }
  };
}

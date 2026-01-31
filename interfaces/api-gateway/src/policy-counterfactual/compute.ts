import { canonicalJson, sha256 } from "../policy-events/hash";
import { calculatePolicyQuality } from "../policy-quality/score";
import type { PolicyDecision } from "../policy-code/types";
import type { PolicyLifecycleStore } from "../policy-lifecycle/store";
import type { PolicyLineageStore } from "../policy-lineage/store";
import type { PolicyOutcomeStore } from "../policy-outcomes/store";
import type { PolicyOutcomeRecord, PolicyOutcomeType } from "../policy-outcomes/types";
import type { PolicyReplayStore } from "../policy-replay/replay-store";
import type { ReplayResultRecord, ReplayRunRecord } from "../policy-replay/types";
import type { BlastRadiusReport, CounterfactualOutcomeDelta, CounterfactualRequest } from "./types";

const RATE_DECIMALS = 4;
const OUTCOME_TYPES: PolicyOutcomeType[] = ["failure", "override", "rollback", "success"];

const DECISION_OUTCOME_MAP: Record<PolicyDecision, PolicyOutcomeType> = {
  ALLOW: "success",
  WARN: "override",
  DENY: "rollback"
};

type WindowBounds = { since: Date; until: Date };

type CounterfactualStores = {
  outcomeStore: PolicyOutcomeStore;
  replayStore: PolicyReplayStore;
  lifecycleStore: PolicyLifecycleStore;
  lineageStore: PolicyLineageStore;
};

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(RATE_DECIMALS));
}

function toIso(date: Date): string {
  return date.toISOString();
}

function resolveWindow(input: {
  since?: string;
  until?: string;
  outcomes: PolicyOutcomeRecord[];
}): WindowBounds {
  const since = input.since ? new Date(input.since) : null;
  const until = input.until ? new Date(input.until) : null;

  if (since && until) {
    return { since, until };
  }

  if (input.outcomes.length === 0) {
    const epoch = new Date(0);
    return { since: since ?? epoch, until: until ?? epoch };
  }

  const observedTimes = input.outcomes.map((outcome) => outcome.observedAt.getTime());
  const minTime = Math.min(...observedTimes);
  const maxTime = Math.max(...observedTimes);

  return {
    since: since ?? new Date(minTime),
    until: until ?? new Date(maxTime)
  };
}

export async function resolveBaselinePolicyHash(input: {
  compareToPolicyHash?: string;
  since?: string;
  lifecycleStore: PolicyLifecycleStore;
  lineageStore: PolicyLineageStore;
}): Promise<string | null> {
  if (input.compareToPolicyHash) {
    return input.compareToPolicyHash;
  }

  const since = input.since ? new Date(input.since) : null;
  const activePolicy = input.lifecycleStore.getActivePolicy()?.policyHash ?? null;
  if (!since) {
    return activePolicy;
  }

  const lineages = await input.lineageStore.listLineages();
  const eligible = lineages.filter((record) => {
    const promotedAt = new Date(record.promotedAt).getTime();
    return Number.isFinite(promotedAt) && promotedAt <= since.getTime();
  });

  if (!eligible.length) {
    return activePolicy;
  }

  eligible.sort((a, b) => {
    if (a.promotedAt !== b.promotedAt) {
      return a.promotedAt.localeCompare(b.promotedAt);
    }
    return a.policyHash.localeCompare(b.policyHash);
  });

  return eligible[eligible.length - 1]?.policyHash ?? activePolicy;
}

function selectReplayRun(input: {
  runs: ReplayRunRecord[];
  baselinePolicyHash: string;
  window: WindowBounds;
}): ReplayRunRecord | null {
  const sinceIso = toIso(input.window.since);
  const untilIso = toIso(input.window.until);

  const candidates = input.runs.filter((run) => run.baselinePolicyHash === input.baselinePolicyHash);
  if (!candidates.length) {
    return null;
  }

  const ranked = candidates
    .slice()
    .sort((a, b) => {
      const aSince = a.since ? toIso(a.since) : null;
      const bSince = b.since ? toIso(b.since) : null;
      const aUntil = a.until ? toIso(a.until) : null;
      const bUntil = b.until ? toIso(b.until) : null;

      const aExact = aSince === sinceIso && aUntil === untilIso;
      const bExact = bSince === sinceIso && bUntil === untilIso;
      if (aExact !== bExact) {
        return aExact ? -1 : 1;
      }

      const aCovers = Boolean(a.since && a.until && a.since <= input.window.since && a.until >= input.window.until);
      const bCovers = Boolean(b.since && b.until && b.since <= input.window.since && b.until >= input.window.until);
      if (aCovers !== bCovers) {
        return aCovers ? -1 : 1;
      }

      if (a.createdAt.getTime() !== b.createdAt.getTime()) {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }

      return a.id.localeCompare(b.id);
    });

  return ranked[0] ?? null;
}

function mapDecisionToOutcome(decision: PolicyDecision): PolicyOutcomeType {
  return DECISION_OUTCOME_MAP[decision];
}

function buildProjectedOutcome(input: {
  outcome: PolicyOutcomeRecord;
  result?: ReplayResultRecord;
  policyHash: string;
}): PolicyOutcomeRecord {
  const decision = input.result?.candidateDecision ?? input.outcome.decision;
  const changed = input.result ? input.result.candidateDecision !== input.result.baselineDecision : false;
  const outcomeType = changed ? mapDecisionToOutcome(decision) : input.outcome.outcomeType;

  return {
    ...input.outcome,
    policyHash: input.policyHash,
    decision,
    outcomeType
  };
}

function buildOutcomeSummary(outcomes: PolicyOutcomeRecord[]) {
  return OUTCOME_TYPES.reduce<Record<PolicyOutcomeType, { count: number; severityTotal: number }>>((acc, outcomeType) => {
    const matches = outcomes.filter((outcome) => outcome.outcomeType === outcomeType);
    acc[outcomeType] = {
      count: matches.length,
      severityTotal: matches.reduce((total, outcome) => total + outcome.severity, 0)
    };
    return acc;
  }, {} as Record<PolicyOutcomeType, { count: number; severityTotal: number }>);
}

function buildOutcomeDeltas(input: {
  before: PolicyOutcomeRecord[];
  after: PolicyOutcomeRecord[];
}): CounterfactualOutcomeDelta[] {
  const beforeSummary = buildOutcomeSummary(input.before);
  const afterSummary = buildOutcomeSummary(input.after);

  return OUTCOME_TYPES.map((outcomeType) => {
    const beforeStats = beforeSummary[outcomeType];
    const afterStats = afterSummary[outcomeType];
    const beforeCount = beforeStats.count;
    const afterCount = afterStats.count;
    const beforeAvg = beforeCount ? beforeStats.severityTotal / beforeCount : 0;
    const afterAvg = afterCount ? afterStats.severityTotal / afterCount : 0;

    const entry: CounterfactualOutcomeDelta = {
      outcomeType,
      beforeCount,
      afterCount,
      delta: afterCount - beforeCount
    };

    if (beforeCount > 0 || afterCount > 0) {
      entry.severityShift = {
        beforeAvg: roundNumber(beforeAvg),
        afterAvg: roundNumber(afterAvg),
        delta: roundNumber(afterAvg - beforeAvg)
      };
    }

    return entry;
  }).sort((a, b) => a.outcomeType.localeCompare(b.outcomeType));
}

function buildDecisionRates(outcomes: PolicyOutcomeRecord[]) {
  const total = outcomes.length;
  if (total === 0) {
    return { approvals: 0, rejections: 0, total };
  }
  const approvals = outcomes.filter((outcome) => outcome.decision === "ALLOW" || outcome.decision === "WARN").length;
  const rejections = outcomes.filter((outcome) => outcome.decision === "DENY").length;
  return { approvals, rejections, total };
}

function roundOptional(value: number | null): number | undefined {
  if (value === null || !Number.isFinite(value)) {
    return undefined;
  }
  return roundNumber(value);
}

export async function buildPolicyCounterfactualReport(
  input: CounterfactualRequest & CounterfactualStores
): Promise<BlastRadiusReport> {
  const baselinePolicyHash = await resolveBaselinePolicyHash({
    compareToPolicyHash: input.compareToPolicyHash,
    since: input.since,
    lifecycleStore: input.lifecycleStore,
    lineageStore: input.lineageStore
  });

  if (!baselinePolicyHash) {
    const emptyReport = {
      policyHash: input.policyHash,
      baselinePolicyHash: input.compareToPolicyHash ?? input.policyHash,
      window: { since: new Date(0).toISOString(), until: new Date(0).toISOString() },
      intentsAffected: 0,
      tracesAffected: 0,
      outcomes: buildOutcomeDeltas({ before: [], after: [] })
    } satisfies Omit<BlastRadiusReport, "reportHash" | "approvalRateDelta" | "rejectionRateDelta" | "riskScoreDelta">;

    const reportHash = sha256(canonicalJson(emptyReport));
    return { ...emptyReport, reportHash };
  }

  const limit = input.limit ?? 500;
  const baselineOutcomes = await input.outcomeStore.listOutcomes({
    policyHash: baselinePolicyHash,
    since: input.since ? new Date(input.since) : undefined,
    until: input.until ? new Date(input.until) : undefined,
    limit
  });

  const window = resolveWindow({ since: input.since, until: input.until, outcomes: baselineOutcomes });
  const runs = await input.replayStore.listRuns({ policyHash: input.policyHash, limit: 200 });
  const selectedRun = selectReplayRun({ runs, baselinePolicyHash, window });
  const results = selectedRun
    ? await input.replayStore.getResults(selectedRun.id, { limit: selectedRun.limit, offset: 0 })
    : [];

  const resultsByTrace = new Map(results.map((result) => [result.traceId, result]));
  const projectedOutcomes = baselineOutcomes.map((outcome) =>
    buildProjectedOutcome({
      outcome,
      result: resultsByTrace.get(outcome.traceId),
      policyHash: input.policyHash
    })
  );

  const projectedByTrace = new Map(projectedOutcomes.map((outcome) => [outcome.traceId, outcome]));
  const affectedTraceIds = new Set(
    baselineOutcomes
      .filter((outcome) => {
        const projected = projectedByTrace.get(outcome.traceId);
        if (!projected) {
          return false;
        }
        return projected.outcomeType !== outcome.outcomeType || projected.decision !== outcome.decision;
      })
      .map((outcome) => outcome.traceId)
  );

  const traceIds = new Set(baselineOutcomes.map((outcome) => outcome.traceId));
  const outcomeDeltas = buildOutcomeDeltas({ before: baselineOutcomes, after: projectedOutcomes });

  const baselineDecisions = buildDecisionRates(baselineOutcomes);
  const projectedDecisions = buildDecisionRates(projectedOutcomes);

  const approvalRateDelta =
    baselineDecisions.total === 0 || projectedDecisions.total === 0
      ? null
      : projectedDecisions.approvals / projectedDecisions.total - baselineDecisions.approvals / baselineDecisions.total;
  const rejectionRateDelta =
    baselineDecisions.total === 0 || projectedDecisions.total === 0
      ? null
      : projectedDecisions.rejections / projectedDecisions.total - baselineDecisions.rejections / baselineDecisions.total;

  const beforeQuality = calculatePolicyQuality(baselineOutcomes);
  const afterQuality = calculatePolicyQuality(projectedOutcomes);
  const beforeRiskScore = 100 - beforeQuality.qualityScore;
  const afterRiskScore = 100 - afterQuality.qualityScore;

  const reportBase: Omit<BlastRadiusReport, "reportHash"> = {
    policyHash: input.policyHash,
    baselinePolicyHash,
    window: { since: toIso(window.since), until: toIso(window.until) },
    intentsAffected: affectedTraceIds.size,
    tracesAffected: traceIds.size,
    outcomes: outcomeDeltas
  };

  const roundedApproval = roundOptional(approvalRateDelta);
  if (roundedApproval !== undefined) {
    reportBase.approvalRateDelta = roundedApproval;
  }
  const roundedRejection = roundOptional(rejectionRateDelta);
  if (roundedRejection !== undefined) {
    reportBase.rejectionRateDelta = roundedRejection;
  }
  const roundedRisk = roundOptional(afterRiskScore - beforeRiskScore);
  if (roundedRisk !== undefined) {
    reportBase.riskScoreDelta = roundedRisk;
  }

  const reportHash = sha256(canonicalJson(reportBase));

  return {
    ...reportBase,
    reportHash
  };
}

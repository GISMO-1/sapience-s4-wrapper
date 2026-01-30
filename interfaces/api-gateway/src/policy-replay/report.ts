import type { PolicyDecision } from "../policy-code/types";
import type { ReplayReport, ReplayReportTotals, ReplayResultRecord, ReplayRunRecord } from "./types";

const decisionRank: Record<PolicyDecision, number> = {
  ALLOW: 0,
  WARN: 1,
  DENY: 2
};

function countDecisions(decisions: PolicyDecision[]): { allow: number; warn: number; deny: number } {
  return {
    allow: decisions.filter((decision) => decision === "ALLOW").length,
    warn: decisions.filter((decision) => decision === "WARN").length,
    deny: decisions.filter((decision) => decision === "DENY").length
  };
}

function compareDecisionStrictness(baseline: PolicyDecision, candidate: PolicyDecision): number {
  return decisionRank[candidate] - decisionRank[baseline];
}

function buildTotals(results: ReplayResultRecord[]): ReplayReportTotals {
  const baselineCounts = countDecisions(results.map((result) => result.baselineDecision));
  const candidateCounts = countDecisions(results.map((result) => result.candidateDecision));
  const changed = results.filter((result) => result.changed).length;
  return {
    count: results.length,
    changed,
    unchanged: results.length - changed,
    baseline: baselineCounts,
    candidate: candidateCounts
  };
}

export function buildReport(run: ReplayRunRecord, results: ReplayResultRecord[]): ReplayReport {
  const totals = buildTotals(results);
  const byIntentTypeMap = new Map<
    ReplayResultRecord["intentType"],
    {
      intentType: ReplayResultRecord["intentType"];
      count: number;
      changed: number;
      baseline: PolicyDecision[];
      candidate: PolicyDecision[];
    }
  >();

  results.forEach((result) => {
    const existing = byIntentTypeMap.get(result.intentType) ?? {
      intentType: result.intentType,
      count: 0,
      changed: 0,
      baseline: [],
      candidate: []
    };
    existing.count += 1;
    if (result.changed) {
      existing.changed += 1;
    }
    existing.baseline.push(result.baselineDecision);
    existing.candidate.push(result.candidateDecision);
    byIntentTypeMap.set(result.intentType, existing);
  });

  const byIntentType = Array.from(byIntentTypeMap.values())
    .map((entry) => ({
      intentType: entry.intentType,
      count: entry.count,
      changed: entry.changed,
      baseline: countDecisions(entry.baseline),
      candidate: countDecisions(entry.candidate)
    }))
    .sort((a, b) => a.intentType.localeCompare(b.intentType));

  const ruleChanges = new Map<
    string,
    {
      ruleId: string;
      changedCount: number;
      moreStrict: number;
      lessStrict: number;
      examples: Array<{ traceId: string; baselineDecision: PolicyDecision; candidateDecision: PolicyDecision }>;
    }
  >();

  results
    .filter((result) => result.changed)
    .forEach((result) => {
      const strictness = compareDecisionStrictness(result.baselineDecision, result.candidateDecision);
      const ruleIds = new Set([...result.baselineMatchedRules, ...result.candidateMatchedRules]);
      ruleIds.forEach((ruleId) => {
        const entry = ruleChanges.get(ruleId) ?? {
          ruleId,
          changedCount: 0,
          moreStrict: 0,
          lessStrict: 0,
          examples: []
        };
        entry.changedCount += 1;
        if (strictness > 0) {
          entry.moreStrict += 1;
        } else if (strictness < 0) {
          entry.lessStrict += 1;
        }
        entry.examples.push({
          traceId: result.traceId,
          baselineDecision: result.baselineDecision,
          candidateDecision: result.candidateDecision
        });
        ruleChanges.set(ruleId, entry);
      });
    });

  const topRuleChanges = Array.from(ruleChanges.values())
    .map((entry) => {
      let direction: "more_strict" | "less_strict" | "mixed" = "mixed";
      if (entry.moreStrict > 0 && entry.lessStrict === 0) {
        direction = "more_strict";
      } else if (entry.lessStrict > 0 && entry.moreStrict === 0) {
        direction = "less_strict";
      }
      return {
        ruleId: entry.ruleId,
        direction,
        changedCount: entry.changedCount,
        examples: entry.examples
          .sort((a, b) => a.traceId.localeCompare(b.traceId))
          .slice(0, 5)
      };
    })
    .sort((a, b) => {
      const countDiff = b.changedCount - a.changedCount;
      if (countDiff !== 0) {
        return countDiff;
      }
      return a.ruleId.localeCompare(b.ruleId);
    });

  const topChangedExamples = results
    .filter((result) => result.changed)
    .sort((a, b) => a.traceId.localeCompare(b.traceId))
    .slice(0, 10)
    .map((result) => ({
      traceId: result.traceId,
      intentType: result.intentType,
      baselineDecision: result.baselineDecision,
      candidateDecision: result.candidateDecision,
      baselineRules: result.baselineMatchedRules,
      candidateRules: result.candidateMatchedRules
    }));

  return {
    run: {
      runId: run.id,
      createdAt: run.createdAt,
      baseline: { hash: run.baselinePolicyHash },
      candidate: {
        hash: run.candidatePolicyHash,
        source: run.candidatePolicySource,
        ref: run.candidatePolicyRef ?? undefined
      },
      filters: {
        intentTypes: run.intentTypeFilter ?? undefined,
        since: run.since ?? undefined,
        until: run.until ?? undefined,
        limit: run.limit
      }
    },
    totals,
    deltas: {
      allowDelta: totals.candidate.allow - totals.baseline.allow,
      warnDelta: totals.candidate.warn - totals.baseline.warn,
      denyDelta: totals.candidate.deny - totals.baseline.deny
    },
    byIntentType,
    topRuleChanges,
    topChangedExamples
  };
}

import type { ReplayResultRecord } from "../policy-replay/types";
import type { PolicyImpactConfig, PolicyImpactCounts, PolicyImpactReport } from "./types";

const DEFAULT_COUNTS: PolicyImpactCounts = {
  changedDecisions: 0,
  denyToAllowFlips: 0,
  rateLimitViolations: 0,
  highRiskSignals: 0
};

function getRiskSignalCount(record: ReplayResultRecord): number {
  if (record.risk.level !== "high") {
    return 0;
  }
  return record.risk.signals.length;
}

function getRateLimitViolations(record: ReplayResultRecord): number {
  const constraints = record.candidateConstraintTypes ?? [];
  return constraints.includes("RATE_LIMIT") ? 1 : 0;
}

export function buildImpactCounts(results: ReplayResultRecord[]): PolicyImpactCounts {
  return results.reduce<PolicyImpactCounts>(
    (counts, record) => ({
      changedDecisions: counts.changedDecisions + (record.changed ? 1 : 0),
      denyToAllowFlips:
        counts.denyToAllowFlips + (record.baselineDecision === "DENY" && record.candidateDecision === "ALLOW" ? 1 : 0),
      rateLimitViolations: counts.rateLimitViolations + getRateLimitViolations(record),
      highRiskSignals: counts.highRiskSignals + getRiskSignalCount(record)
    }),
    DEFAULT_COUNTS
  );
}

export function calculatePolicyImpact(results: ReplayResultRecord[], config: PolicyImpactConfig): PolicyImpactReport {
  const counts = buildImpactCounts(results);
  const score =
    counts.changedDecisions * config.weights.changedDecisions +
    counts.denyToAllowFlips * config.weights.denyToAllowFlips +
    counts.rateLimitViolations * config.weights.rateLimitViolations +
    counts.highRiskSignals * config.weights.highRiskSignals;

  const exceeded: string[] = [];
  if (score > config.thresholds.score) {
    exceeded.push("score");
  }
  if (counts.changedDecisions > config.thresholds.changedDecisions) {
    exceeded.push("changedDecisions");
  }
  if (counts.denyToAllowFlips > config.thresholds.denyToAllowFlips) {
    exceeded.push("denyToAllowFlips");
  }
  if (counts.rateLimitViolations > config.thresholds.rateLimitViolations) {
    exceeded.push("rateLimitViolations");
  }
  if (counts.highRiskSignals > config.thresholds.highRiskSignals) {
    exceeded.push("highRiskSignals");
  }

  return {
    score,
    weights: config.weights,
    counts,
    thresholds: config.thresholds,
    exceeded,
    blocked: exceeded.length > 0
  };
}

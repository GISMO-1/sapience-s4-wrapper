import type { PolicyDecision } from "../policy-code/types";
import type { ReplayResultRecord } from "../policy-replay/types";
import type { PolicyDriftSummary } from "./types";

const DECISION_SEVERITY: Record<PolicyDecision, number> = {
  ALLOW: 0,
  WARN: 1,
  DENY: 2
};

const RISK_SCORE: Record<ReplayResultRecord["risk"]["level"], number> = {
  low: 1,
  medium: 2,
  high: 3
};

export function buildPolicyDriftSummary(results: ReplayResultRecord[]): PolicyDriftSummary {
  const baselineRules = new Set<string>();
  const candidateRules = new Set<string>();
  let severityDelta = 0;
  let netRiskScoreChange = 0;

  results.forEach((result) => {
    result.baselineMatchedRules.forEach((rule) => baselineRules.add(rule));
    result.candidateMatchedRules.forEach((rule) => candidateRules.add(rule));
    severityDelta += DECISION_SEVERITY[result.candidateDecision] - DECISION_SEVERITY[result.baselineDecision];
    netRiskScoreChange += RISK_SCORE[result.risk.level] - RISK_SCORE[result.baselineRisk.level];
  });

  const constraintsAdded = Array.from(candidateRules).filter((rule) => !baselineRules.has(rule)).length;
  const constraintsRemoved = Array.from(baselineRules).filter((rule) => !candidateRules.has(rule)).length;

  return {
    constraintsAdded,
    constraintsRemoved,
    severityDelta,
    netRiskScoreChange
  };
}

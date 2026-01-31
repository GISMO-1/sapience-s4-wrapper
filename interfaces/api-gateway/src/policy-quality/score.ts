import type { PolicyOutcomeRecord, PolicyOutcomeType } from "../policy-outcomes/types";
import type { PolicyQualityMetrics } from "./types";

const outcomeWeights: Record<PolicyOutcomeType, number> = {
  failure: 3,
  rollback: 2,
  override: 1,
  success: 0
};

export function calculatePolicyQuality(outcomes: PolicyOutcomeRecord[]): PolicyQualityMetrics {
  const totalOutcomes = outcomes.length;
  if (totalOutcomes === 0) {
    return {
      totalOutcomes: 0,
      failureRate: 0,
      overrideRate: 0,
      weightedPenalty: 0,
      qualityScore: 0
    };
  }

  const failures = outcomes.filter((outcome) => outcome.outcomeType === "failure").length;
  const overrides = outcomes.filter((outcome) => outcome.outcomeType === "override").length;
  const weightedPenalty = outcomes.reduce((total, outcome) => {
    return total + outcome.severity * outcomeWeights[outcome.outcomeType];
  }, 0);
  const normalizedPenalty = (weightedPenalty / (totalOutcomes * 5 * 3)) * 100;
  const qualityScore = Math.max(0, 100 - normalizedPenalty);

  return {
    totalOutcomes,
    failureRate: failures / totalOutcomes,
    overrideRate: overrides / totalOutcomes,
    weightedPenalty,
    qualityScore
  };
}

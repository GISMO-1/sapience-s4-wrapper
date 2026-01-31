import type { HealthState, DriftWindow } from "../policy-drift/types";
import type { AcceptedRisk, DecisionOutcome, DecisionType } from "../decision-rationale/types";

export type TrustReport = {
  policyHash: string;
  generatedAt: string;
  healthState: HealthState;
  lastDecisionSummary: {
    decisionType: DecisionType;
    outcome: DecisionOutcome;
    confidenceScore: number;
    acceptedRisk: AcceptedRisk;
  };
  driftSummary: {
    window: DriftWindow;
    deltaCounts: {
      failureRateDelta: number;
      overrideRateDelta: number;
      qualityScoreDelta: number;
      replayDelta: number;
    };
    severity: HealthState;
  };
  determinismStatus: {
    reproducible: boolean;
    lastVerifiedAt: string;
  };
  rollbackStatus: {
    lastRollbackAt: string | null;
    reconciled: boolean;
  };
  counterfactualSummary: {
    alternativesEvaluated: number;
    maxDeltaSeverity: number;
  };
  provenanceHash: string;
  overallTrustScore: number;
};

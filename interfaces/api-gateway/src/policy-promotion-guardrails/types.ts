import type { DriftReport, HealthState } from "../policy-drift/types";
import type { PolicyImpactReport } from "../policy-impact/types";
import type { PolicyLineageRecord } from "../policy-lineage/types";
import type { PolicyQualityMetrics } from "../policy-quality/types";

export type Thresholds = {
  maxBlastRadius: number;
  maxImpactedIntents: number;
  maxSeverityDelta: number;
  minHealthState: HealthState;
  maxQualityScore: number;
};

export type GuardrailConfig = {
  enabled: boolean;
  thresholds: Thresholds;
  requireRationale: boolean;
  requireAcceptedRisk: boolean;
};

export type FailureReasonCode =
  | "BLAST_RADIUS_EXCEEDED"
  | "IMPACTED_INTENTS_EXCEEDED"
  | "SEVERITY_DELTA_EXCEEDED"
  | "HEALTH_STATE_TOO_LOW"
  | "QUALITY_SCORE_TOO_HIGH";

export type FailureReason = {
  code: FailureReasonCode;
  message: string;
  metric: number | string;
  threshold: number | string;
};

export type GuardrailDecision = {
  allowed: boolean;
  requiredAcceptance: boolean;
  reasons: FailureReason[];
  snapshot: {
    policyHash: string;
    evaluatedAt: string;
    drift: DriftReport;
    impact: PolicyImpactReport & {
      impactedIntents: number;
    };
    quality: PolicyQualityMetrics & {
      score: number;
    };
    lineageHead: PolicyLineageRecord | null;
  };
};

export type GuardrailCheckInput = {
  policyHash: string;
  evaluatedAt: string;
  actor: string;
  rationale: string;
  decision: GuardrailDecision;
};

export type GuardrailCheckRecord = GuardrailCheckInput & {
  id: string;
  createdAt: string;
};

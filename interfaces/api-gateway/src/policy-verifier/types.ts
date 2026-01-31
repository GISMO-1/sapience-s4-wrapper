import type { PolicyLifecycleTimeline } from "../policy-lifecycle/timeline";
import type { PolicyLineageRecord } from "../policy-lineage/types";
import type { DriftReport } from "../policy-drift/types";
import type { PolicyQualityMetrics } from "../policy-quality/types";
import type { GuardrailDecision } from "../policy-promotion-guardrails/types";

export type DerivedSnapshot = {
  policyHash: string;
  activePolicyHash: string | null;
  lifecycle: PolicyLifecycleTimeline;
  lineage: PolicyLineageRecord | null;
  driftReport: DriftReport | null;
  quality: PolicyQualityMetrics;
  guardrailDecision: GuardrailDecision | null;
};

export type VerificationMismatch = {
  field: string;
  expected: unknown;
  actual: unknown;
};

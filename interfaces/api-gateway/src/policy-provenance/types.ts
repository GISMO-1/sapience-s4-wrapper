import type { PolicyLifecycleRecord } from "../policy-lifecycle/types";
import type { PolicyLifecycleTimeline } from "../policy-lifecycle/timeline";
import type { GuardrailCheckRecord } from "../policy-promotion-guardrails/types";
import type { PolicyApprovalRecord } from "../policy-approvals/types";
import type { DriftReport, DriftWindow } from "../policy-drift/types";
import type { PolicyImpactReport } from "../policy-impact/types";
import type { VerificationMismatch } from "../policy-verifier/types";
import type { RollbackEvent } from "../policy-rollback/types";

export type PolicyProvenanceMetadata = {
  policyHash: string;
  lifecycleState: PolicyLifecycleRecord["state"] | null;
  statusUpdatedAt: string | null;
  version: string | null;
  path: string | null;
  source: PolicyLifecycleRecord["source"] | null;
  ref: string | null;
  inlineYaml: string | null;
  loadedAt: string | null;
};

export type PolicyImpactSimulationSummary = {
  evaluatedAt: string;
  policyHashCurrent: string;
  policyHashCandidate: string;
  window: PolicyImpactReport["window"];
  totals: PolicyImpactReport["totals"] & { impactedIntents: number };
  blastRadiusScore: number;
};

export type PolicyDeterminismVerification = {
  verified: boolean;
  mismatches: VerificationMismatch[];
  eventCount: number;
  lastEventHash: string | null;
  windows: {
    drift: { recent: DriftWindow; baseline: DriftWindow };
    quality: DriftWindow | null;
  };
};

export type PolicyProvenanceReport = {
  policyHash: string;
  asOf: string;
  metadata: PolicyProvenanceMetadata;
  lifecycle: PolicyLifecycleTimeline;
  lastRollback: RollbackEvent | null;
  guardrailChecks: GuardrailCheckRecord[];
  approvals: PolicyApprovalRecord[];
  driftReport: DriftReport | null;
  impactSimulationSummary: PolicyImpactSimulationSummary | null;
  counterfactualReportHash?: string;
  determinism: PolicyDeterminismVerification;
  reportHash: string;
};

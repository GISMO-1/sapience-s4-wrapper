import type { PolicyInfo } from "../policy-code/types";
import type { PolicyLifecycleStore } from "../policy-lifecycle/store";
import type { PolicyLineageStore } from "../policy-lineage/store";
import type { PolicyReplayStore } from "../policy-replay/replay-store";
import type { GuardrailCheckStore } from "../policy-promotion-guardrails/store";
import type { PolicyApprovalStore } from "../policy-approvals/store";
import type { PolicyOutcomeStore } from "../policy-outcomes/store";
import type { PolicyRollbackStore } from "../policy-rollback/store";
import type { DecisionRationaleStore } from "../decision-rationale/store";
import type { DecisionRationale } from "../decision-rationale/types";
import { buildPolicyCounterfactualReport } from "../policy-counterfactual/compute";
import { buildPolicyProvenanceReport } from "../policy-provenance/build";
import type { BlastRadiusReport } from "../policy-counterfactual/types";
import type { TrustReport } from "./types";

const RATE_DECIMALS = 4;
const SCORE_DECIMALS = 2;

const HEALTH_SCORE_MAP: Record<TrustReport["healthState"], number> = {
  HEALTHY: 100,
  WATCH: 80,
  DEGRADED: 55,
  CRITICAL: 25
};

// Deterministic weights for composite trust score.
const TRUST_WEIGHTS = {
  health: 0.3,
  determinism: 0.25,
  drift: 0.2,
  confidence: 0.15,
  rollback: 0.1
};

type BuildTrustReportInput = {
  policyHash: string;
  activePolicyHash: string | null;
  lifecycleStore: PolicyLifecycleStore;
  lineageStore: PolicyLineageStore;
  replayStore: PolicyReplayStore;
  guardrailCheckStore: GuardrailCheckStore;
  approvalStore: PolicyApprovalStore;
  outcomeStore: PolicyOutcomeStore;
  rollbackStore: PolicyRollbackStore;
  decisionRationaleStore: DecisionRationaleStore;
  policyInfo?: PolicyInfo;
};

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = RATE_DECIMALS): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(decimals));
}

function roundScore(value: number): number {
  return round(value, SCORE_DECIMALS);
}

function resolveLatestDecision(decisions: DecisionRationale[]) {
  if (!decisions.length) {
    return null;
  }
  const sorted = decisions.slice().sort((a, b) => {
    if (a.timestamps.decidedAt !== b.timestamps.decidedAt) {
      return a.timestamps.decidedAt.localeCompare(b.timestamps.decidedAt);
    }
    return a.decisionId.localeCompare(b.decisionId);
  });
  return sorted[sorted.length - 1] ?? null;
}

function summarizeCounterfactual(report: BlastRadiusReport): TrustReport["counterfactualSummary"] {
  const maxDelta = report.outcomes.reduce((max, outcome) => {
    const severityDelta = outcome.severityShift?.delta ?? 0;
    return Math.max(max, Math.abs(severityDelta));
  }, 0);

  return {
    alternativesEvaluated: report.intentsAffected,
    maxDeltaSeverity: round(maxDelta)
  };
}

function computeTrustScore(input: {
  healthState: TrustReport["healthState"];
  driftScore: number;
  confidenceScore: number;
  reproducible: boolean;
  rollbackReconciled: boolean;
}): number {
  const healthScore = HEALTH_SCORE_MAP[input.healthState] ?? HEALTH_SCORE_MAP.HEALTHY;
  const determinismScore = input.reproducible ? 100 : 0;
  const rollbackScore = input.rollbackReconciled ? 100 : 0;
  const driftScore = clamp(input.driftScore, 0, 100);
  const confidenceScore = clamp(input.confidenceScore, 0, 100);

  const weighted =
    healthScore * TRUST_WEIGHTS.health +
    determinismScore * TRUST_WEIGHTS.determinism +
    driftScore * TRUST_WEIGHTS.drift +
    confidenceScore * TRUST_WEIGHTS.confidence +
    rollbackScore * TRUST_WEIGHTS.rollback;

  return clamp(roundScore(weighted), 0, 100);
}

export async function buildTrustReport(input: BuildTrustReportInput): Promise<TrustReport> {
  const provenance = await buildPolicyProvenanceReport({
    policyHash: input.policyHash,
    activePolicyHash: input.activePolicyHash,
    lifecycleStore: input.lifecycleStore,
    lineageStore: input.lineageStore,
    replayStore: input.replayStore,
    guardrailCheckStore: input.guardrailCheckStore,
    approvalStore: input.approvalStore,
    outcomeStore: input.outcomeStore,
    rollbackStore: input.rollbackStore,
    decisionRationaleStore: input.decisionRationaleStore,
    policyInfo: input.policyInfo
  });

  const decisions = await input.decisionRationaleStore.listDecisionRationalesByPolicyHash(input.policyHash);
  const lastDecision = resolveLatestDecision(decisions);
  const defaultDecision: TrustReport["lastDecisionSummary"] = {
    decisionType: "EXECUTION",
    outcome: "FAIL",
    confidenceScore: 0,
    acceptedRisk: {
      severity: "LOW",
      justification: "No recorded decisions available for this policy snapshot.",
      reviewer: null,
      score: null
    }
  };

  const driftReport = provenance.driftReport;
  const driftWindow = driftReport?.recent.window ?? { since: new Date(0).toISOString(), until: new Date(0).toISOString() };
  const driftDeltas = driftReport?.deltas ?? {
    failureRateDelta: 0,
    overrideRateDelta: 0,
    qualityScoreDelta: 0,
    replayDelta: 0
  };
  const driftSeverity = driftReport?.health.state ?? "HEALTHY";

  const counterfactual = await buildPolicyCounterfactualReport({
    policyHash: input.policyHash,
    outcomeStore: input.outcomeStore,
    replayStore: input.replayStore,
    lifecycleStore: input.lifecycleStore,
    lineageStore: input.lineageStore
  });

  const lastRollbackAt = provenance.lastRollback?.createdAt ?? null;
  const rollbackReconciled = provenance.lastRollback
    ? provenance.lastRollback.toPolicyHash === input.activePolicyHash
    : true;

  const lastDecisionSummary = lastDecision
    ? {
        decisionType: lastDecision.decisionType,
        outcome: lastDecision.outcome,
        confidenceScore: lastDecision.confidenceScore,
        acceptedRisk: lastDecision.acceptedRisk
      }
    : defaultDecision;

  const confidenceScore = clamp(lastDecisionSummary.confidenceScore * 100, 0, 100);
  const driftScore = driftReport?.recent.metrics.qualityScore ?? 0;

  const overallTrustScore = computeTrustScore({
    healthState: driftSeverity,
    driftScore,
    confidenceScore,
    reproducible: provenance.determinism.verified,
    rollbackReconciled
  });

  return {
    policyHash: input.policyHash,
    generatedAt: provenance.asOf,
    healthState: driftSeverity,
    lastDecisionSummary,
    driftSummary: {
      window: driftWindow,
      deltaCounts: driftDeltas,
      severity: driftSeverity
    },
    determinismStatus: {
      reproducible: provenance.determinism.verified,
      lastVerifiedAt: provenance.asOf
    },
    rollbackStatus: {
      lastRollbackAt,
      reconciled: rollbackReconciled
    },
    counterfactualSummary: summarizeCounterfactual(counterfactual),
    provenanceHash: provenance.reportHash,
    overallTrustScore
  };
}

export function buildTrustReportMarkdown(report: TrustReport): string {
  const lines: string[] = [];
  lines.push("# System Trust Report");
  lines.push("");
  lines.push(`- Policy Hash: ${report.policyHash}`);
  lines.push(`- Generated At: ${report.generatedAt}`);
  lines.push(`- Overall Trust Score: ${report.overallTrustScore.toFixed(2)}`);
  lines.push(`- Health State: ${report.healthState}`);
  lines.push(`- Determinism Verified: ${report.determinismStatus.reproducible ? "Yes" : "No"}`);
  lines.push(`- Provenance Hash: ${report.provenanceHash}`);
  lines.push("");
  lines.push("## Last Decision");
  lines.push(
    `- ${report.lastDecisionSummary.decisionType} → ${report.lastDecisionSummary.outcome} ` +
      `(confidence ${report.lastDecisionSummary.confidenceScore.toFixed(RATE_DECIMALS)})`
  );
  lines.push("");
  lines.push("## Drift Summary");
  lines.push(`- Window: ${report.driftSummary.window.since} → ${report.driftSummary.window.until}`);
  lines.push(`- Severity: ${report.driftSummary.severity}`);
  lines.push(
    `- Δ failure ${report.driftSummary.deltaCounts.failureRateDelta.toFixed(RATE_DECIMALS)}, ` +
      `override ${report.driftSummary.deltaCounts.overrideRateDelta.toFixed(RATE_DECIMALS)}, ` +
      `quality ${report.driftSummary.deltaCounts.qualityScoreDelta.toFixed(RATE_DECIMALS)}, ` +
      `replay ${report.driftSummary.deltaCounts.replayDelta}`
  );
  lines.push("");
  lines.push("## Determinism");
  lines.push(`- Last Verified At: ${report.determinismStatus.lastVerifiedAt}`);
  lines.push("");
  lines.push("## Rollback");
  lines.push(`- Last Rollback At: ${report.rollbackStatus.lastRollbackAt ?? "none"}`);
  lines.push(`- Reconciled: ${report.rollbackStatus.reconciled ? "Yes" : "No"}`);
  lines.push("");
  lines.push("## Counterfactual");
  lines.push(`- Alternatives Evaluated: ${report.counterfactualSummary.alternativesEvaluated}`);
  lines.push(`- Max Severity Δ: ${report.counterfactualSummary.maxDeltaSeverity.toFixed(RATE_DECIMALS)}`);
  return lines.join("\n");
}

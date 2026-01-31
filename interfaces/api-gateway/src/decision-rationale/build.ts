import { canonicalJson, sha256 } from "../policy-events/hash";
import type { PolicyDecisionResult } from "../policy-code/types";
import type { PolicyDecisionRecord } from "../policy/policy-store";
import type { IntentApprovalRecord } from "../intent-approvals/types";
import type { GuardrailDecision } from "../policy-promotion-guardrails/types";
import type { PolicyPromotionRecord } from "../policy-promotions/types";
import type { PolicyApprovalRecord } from "../policy-approvals/types";
import type { PolicyQualityMetrics } from "../policy-quality/types";
import type { BlastRadiusReport } from "../policy-counterfactual/types";
import type { RollbackDecision, RollbackEvent } from "../policy-rollback/types";
import type {
  AcceptedRisk,
  DecisionOutcome,
  DecisionRationale,
  DecisionType,
  RationaleBlock,
  RejectedAlternative
} from "./types";

type ExecutionRationaleInput = {
  decisionType: "EXECUTION";
  traceId: string;
  policyHash: string;
  policyDecision: PolicyDecisionResult;
  decisionRecord: PolicyDecisionRecord;
  approvals: IntentApprovalRecord[];
  totalRules: number;
};

type PromotionRationaleInput = {
  decisionType: "PROMOTION";
  traceId: string;
  policyHash: string;
  promotion: PolicyPromotionRecord;
  guardrailDecision: GuardrailDecision;
  approval?: PolicyApprovalRecord | null;
  counterfactual?: BlastRadiusReport | null;
};

type RollbackRationaleInput = {
  decisionType: "ROLLBACK";
  traceId: string;
  policyHash: string;
  decision: RollbackDecision;
  event: RollbackEvent | null;
};

type CounterfactualRationaleInput = {
  decisionType: "COUNTERFACTUAL";
  traceId: string;
  policyHash: string;
  report: BlastRadiusReport;
};

export type DecisionRationaleInput =
  | ExecutionRationaleInput
  | PromotionRationaleInput
  | RollbackRationaleInput
  | CounterfactualRationaleInput;

const CONFIDENCE_WEIGHTS = {
  coverage: 0.4,
  variance: 0.3,
  counterfactual: 0.3
};

const RISK_VARIANCE_MAP: Record<PolicyDecisionResult["risk"]["level"], number> = {
  low: 0.1,
  medium: 0.3,
  high: 0.6
};

const BLOCK_ORDER: Array<RationaleBlock["type"]> = [
  "RULE_EVALUATION",
  "GUARDRAIL_CHECK",
  "THRESHOLD_CROSSED",
  "HUMAN_OVERRIDE"
];

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Number(value.toFixed(4));
}

export function buildDecisionId(seed: {
  decisionType: DecisionType;
  traceId: string;
  policyHash: string;
  outcome: DecisionOutcome;
  decidedAt: string;
  context: Record<string, unknown>;
}): string {
  return sha256(canonicalJson(seed));
}

function buildConfidenceScore(input: {
  ruleCoverage: number;
  varianceScore: number;
  counterfactualScore: number;
}): number {
  const coverage = clamp(input.ruleCoverage);
  const variance = clamp(input.varianceScore);
  const counterfactual = clamp(input.counterfactualScore);
  const raw =
    coverage * CONFIDENCE_WEIGHTS.coverage +
    variance * CONFIDENCE_WEIGHTS.variance +
    counterfactual * CONFIDENCE_WEIGHTS.counterfactual;
  return roundScore(raw);
}

function buildVarianceScore(input: {
  quality?: PolicyQualityMetrics;
  riskLevel?: PolicyDecisionResult["risk"]["level"];
}): number {
  if (input.quality) {
    const variance = clamp((input.quality.failureRate + input.quality.overrideRate) / 2);
    return clamp(1 - variance);
  }
  if (input.riskLevel) {
    const variance = RISK_VARIANCE_MAP[input.riskLevel] ?? 0.5;
    return clamp(1 - variance);
  }
  return 0.5;
}

function buildCounterfactualScore(report?: BlastRadiusReport | null): number {
  if (!report) {
    return 1;
  }
  const delta =
    report.riskScoreDelta ??
    report.rejectionRateDelta ??
    report.approvalRateDelta ??
    Math.max(0, ...report.outcomes.map((outcome) => Math.abs(outcome.delta)));
  const normalized = clamp(Math.abs(delta));
  return clamp(1 - normalized);
}

function buildOutcome(entries: Array<{ type: "failure" | "rollback"; delta: number }>): DecisionOutcome {
  if (entries.some((entry) => entry.delta > 0)) {
    return "WARN";
  }
  return "ALLOW";
}

function buildRejectedAlternatives(report?: BlastRadiusReport | null): RejectedAlternative[] {
  if (!report) {
    return [];
  }
  return report.outcomes
    .slice()
    .sort((a, b) => a.outcomeType.localeCompare(b.outcomeType))
    .map((outcome) => {
      const details = outcome.severityShift
        ? `severity Δ ${outcome.severityShift.delta.toFixed(4)}`
        : null;
      return {
        label: `Outcome ${outcome.outcomeType}`,
        delta: outcome.delta,
        details
      };
    });
}

function formatGuardrailReason(reason: GuardrailDecision["reasons"][number]): string {
  return `${reason.code}: ${reason.message} (metric ${reason.metric} vs threshold ${reason.threshold})`;
}

function buildRuleEvaluationBlock(entries: string[], summary: string): RationaleBlock | null {
  if (!entries.length) {
    return null;
  }
  return {
    type: "RULE_EVALUATION",
    summary,
    entries
  };
}

function buildGuardrailBlock(entries: string[], summary: string): RationaleBlock | null {
  if (!entries.length) {
    return null;
  }
  return {
    type: "GUARDRAIL_CHECK",
    summary,
    entries
  };
}

function buildThresholdBlock(entries: string[], summary: string): RationaleBlock | null {
  if (!entries.length) {
    return null;
  }
  return {
    type: "THRESHOLD_CROSSED",
    summary,
    entries
  };
}

function buildHumanOverrideBlock(entries: string[], summary: string): RationaleBlock | null {
  if (!entries.length) {
    return null;
  }
  return {
    type: "HUMAN_OVERRIDE",
    summary,
    entries
  };
}

function buildAcceptedRisk(input: {
  severity: AcceptedRisk["severity"];
  justification: string;
  reviewer?: string | null;
  score?: number | null;
}): AcceptedRisk {
  return {
    severity: input.severity,
    justification: input.justification,
    reviewer: input.reviewer ?? null,
    score: input.score ?? null
  };
}

function mapRiskScoreToSeverity(score?: number | null): AcceptedRisk["severity"] {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return "LOW";
  }
  if (score >= 0.7) {
    return "HIGH";
  }
  if (score >= 0.4) {
    return "MEDIUM";
  }
  return "LOW";
}

function sortBlocks(blocks: Array<RationaleBlock | null>): RationaleBlock[] {
  const filtered = blocks.filter((block): block is RationaleBlock => Boolean(block));
  return filtered.sort((a, b) => BLOCK_ORDER.indexOf(a.type) - BLOCK_ORDER.indexOf(b.type));
}

export function buildDecisionRationale(input: DecisionRationaleInput): DecisionRationale {
  if (input.decisionType === "EXECUTION") {
    const matchedRules = input.policyDecision.matchedRules
      .slice()
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    const ruleEntries = matchedRules.map((rule) => `Rule ${rule.ruleId} → ${rule.decision}: ${rule.reason}`);
    const thresholdEntries = input.policyDecision.reasons
      .slice()
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId))
      .map((reason) => `Rule ${reason.ruleId}: ${reason.reason}`);
    const approvals = input.approvals
      .slice()
      .sort((a, b) => {
        if (a.requiredRole !== b.requiredRole) {
          return a.requiredRole.localeCompare(b.requiredRole);
        }
        if (a.actor !== b.actor) {
          return a.actor.localeCompare(b.actor);
        }
        return a.approvedAt.getTime() - b.approvedAt.getTime();
      });
    const overrideEntries = approvals.map(
      (approval) => `${approval.requiredRole} approved by ${approval.actor}: ${approval.rationale}`
    );

    const ruleCoverage = input.totalRules > 0 ? matchedRules.length / input.totalRules : 1;
    const varianceScore = buildVarianceScore({ riskLevel: input.policyDecision.risk.level });
    const confidenceScore = buildConfidenceScore({
      ruleCoverage,
      varianceScore,
      counterfactualScore: 1
    });

    const decidedAt = input.decisionRecord.createdAt.toISOString();
    const outcome = input.policyDecision.final;
    const decisionId = buildDecisionId({
      decisionType: "EXECUTION",
      traceId: input.traceId,
      policyHash: input.policyHash,
      outcome,
      decidedAt,
      context: {
        matchedRuleIds: matchedRules.map((rule) => rule.ruleId),
        categories: input.policyDecision.categories.slice().sort((a, b) => a.localeCompare(b))
      }
    });

    const severity =
      input.policyDecision.risk.level === "high"
        ? "HIGH"
        : input.policyDecision.risk.level === "medium"
          ? "MEDIUM"
          : "LOW";

    return {
      decisionId,
      traceId: input.traceId,
      policyHash: input.policyHash,
      decisionType: "EXECUTION",
      outcome,
      confidenceScore,
      rationaleBlocks: sortBlocks([
        buildRuleEvaluationBlock(ruleEntries, `${matchedRules.length} rule evaluation(s) matched.`),
        buildGuardrailBlock([], ""),
        buildThresholdBlock(thresholdEntries, "Thresholds evaluated from matched rules."),
        buildHumanOverrideBlock(overrideEntries, "Manual approvals recorded.")
      ]),
      rejectedAlternatives: [],
      acceptedRisk: buildAcceptedRisk({
        severity,
        justification:
          input.policyDecision.risk.signals[0]?.note ??
          `Risk level ${input.policyDecision.risk.level} recorded for execution.`
      }),
      timestamps: {
        decidedAt,
        recordedAt: decidedAt
      }
    };
  }

  if (input.decisionType === "PROMOTION") {
    const reasons = input.guardrailDecision.reasons
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((reason) => formatGuardrailReason(reason));
    const guardrailEntries = reasons.length
      ? reasons
      : [`Guardrail decision: ${input.guardrailDecision.allowed ? "allowed" : "blocked"}.`];
    const thresholdEntries = reasons.length
      ? reasons.map((reason) => `Threshold ${reason}`)
      : [];
    const humanEntries: string[] = [];
    if (input.promotion.forced) {
      humanEntries.push("Promotion forced by reviewer.");
    }
    if (input.approval) {
      humanEntries.push(
        `Approval by ${input.approval.approvedBy}: ${input.approval.rationale}`
      );
    } else {
      humanEntries.push(`Reviewer ${input.promotion.reviewer} recorded promotion rationale.`);
    }

    const quality: PolicyQualityMetrics = {
      totalOutcomes: input.guardrailDecision.snapshot.quality.totalOutcomes,
      failureRate: input.guardrailDecision.snapshot.quality.failureRate,
      overrideRate: input.guardrailDecision.snapshot.quality.overrideRate,
      weightedPenalty: input.guardrailDecision.snapshot.quality.weightedPenalty,
      qualityScore: input.guardrailDecision.snapshot.quality.qualityScore
    };
    const varianceScore = buildVarianceScore({ quality });
    const confidenceScore = buildConfidenceScore({
      ruleCoverage: 1,
      varianceScore,
      counterfactualScore: buildCounterfactualScore(input.counterfactual)
    });

    const decidedAt = input.approval?.approvedAt ?? input.promotion.evaluatedAt;
    const outcome: DecisionOutcome = input.guardrailDecision.allowed
      ? input.guardrailDecision.requiredAcceptance
        ? "WARN"
        : "ALLOW"
      : "DENY";
    const decisionId = buildDecisionId({
      decisionType: "PROMOTION",
      traceId: input.traceId,
      policyHash: input.policyHash,
      outcome,
      decidedAt,
      context: {
        guardrailAllowed: input.guardrailDecision.allowed,
        guardrailReasons: input.guardrailDecision.reasons
          .map((reason) => reason.code)
          .slice()
          .sort((a, b) => a.localeCompare(b)),
        reviewer: input.promotion.reviewer
      }
    });

    return {
      decisionId,
      traceId: input.traceId,
      policyHash: input.policyHash,
      decisionType: "PROMOTION",
      outcome,
      confidenceScore,
      rationaleBlocks: sortBlocks([
        buildRuleEvaluationBlock(
          [
            `Impacted intents: ${input.guardrailDecision.snapshot.impact.impactedIntents}`,
            `Blast radius score: ${input.guardrailDecision.snapshot.impact.blastRadiusScore.toFixed(2)}`
          ],
          "Guardrail impact summary."
        ),
        buildGuardrailBlock(guardrailEntries, "Promotion guardrail evaluation."),
        buildThresholdBlock(thresholdEntries, "Guardrail thresholds evaluated."),
        buildHumanOverrideBlock(humanEntries, "Reviewer acknowledgement recorded.")
      ]),
      rejectedAlternatives: buildRejectedAlternatives(input.counterfactual),
      acceptedRisk: buildAcceptedRisk({
        severity: mapRiskScoreToSeverity(input.promotion.acceptedRisk ?? undefined),
        justification: input.promotion.rationale,
        reviewer: input.promotion.reviewer,
        score: input.promotion.acceptedRisk ?? null
      }),
      timestamps: {
        decidedAt,
        recordedAt: decidedAt
      }
    };
  }

  if (input.decisionType === "ROLLBACK") {
    const decidedAt = input.decision.createdAt;
    const outcome: DecisionOutcome = input.decision.ok ? "ALLOW" : "DENY";
    const decisionId = buildDecisionId({
      decisionType: "ROLLBACK",
      traceId: input.traceId,
      policyHash: input.policyHash,
      outcome,
      decidedAt,
      context: {
        decisionHash: input.decision.decisionHash,
        fromPolicyHash: input.decision.fromPolicyHash,
        toPolicyHash: input.decision.toPolicyHash
      }
    });

    const ruleEntries = input.decision.reasons.length
      ? input.decision.reasons
      : ["Rollback decision passed validation checks."];
    const humanEntries = input.event
      ? [`Rollback executed by ${input.event.actor}: ${input.event.rationale}`]
      : [];

    return {
      decisionId,
      traceId: input.traceId,
      policyHash: input.policyHash,
      decisionType: "ROLLBACK",
      outcome,
      confidenceScore: buildConfidenceScore({ ruleCoverage: 1, varianceScore: 1, counterfactualScore: 1 }),
      rationaleBlocks: sortBlocks([
        buildRuleEvaluationBlock(ruleEntries, "Rollback decision rationale."),
        buildGuardrailBlock([], ""),
        buildThresholdBlock([], ""),
        buildHumanOverrideBlock(humanEntries, "Rollback approval recorded.")
      ]),
      rejectedAlternatives: [],
      acceptedRisk: buildAcceptedRisk({
        severity: "LOW",
        justification: input.event?.rationale ?? "Rollback executed to restore a prior policy state.",
        reviewer: input.event?.actor ?? null
      }),
      timestamps: {
        decidedAt,
        recordedAt: decidedAt
      }
    };
  }

  const report = input.report;
  const outcome = buildOutcome(
    report.outcomes
      .filter((entry) => entry.outcomeType === "failure" || entry.outcomeType === "rollback")
      .map((entry) => ({ type: entry.outcomeType as "failure" | "rollback", delta: entry.delta }))
  );
  const decidedAt = report.window.until;
  const decisionId = buildDecisionId({
    decisionType: "COUNTERFACTUAL",
    traceId: input.traceId,
    policyHash: input.policyHash,
    outcome,
    decidedAt,
    context: {
      reportHash: report.reportHash,
      baselinePolicyHash: report.baselinePolicyHash
    }
  });

  return {
    decisionId,
    traceId: input.traceId,
    policyHash: input.policyHash,
    decisionType: "COUNTERFACTUAL",
    outcome,
    confidenceScore: buildConfidenceScore({
      ruleCoverage: 1,
      varianceScore: buildVarianceScore({ quality: undefined }),
      counterfactualScore: buildCounterfactualScore(report)
    }),
    rationaleBlocks: sortBlocks([
      buildRuleEvaluationBlock(
        [
          `Window: ${report.window.since} → ${report.window.until}`,
          `Intents affected: ${report.intentsAffected}`,
          `Traces affected: ${report.tracesAffected}`
        ],
        "Counterfactual window summary."
      ),
      buildGuardrailBlock([], ""),
      buildThresholdBlock(
        report.outcomes
          .slice()
          .sort((a, b) => a.outcomeType.localeCompare(b.outcomeType))
          .map((entry) => `Outcome ${entry.outcomeType} delta: ${entry.delta}`),
        "Counterfactual deltas evaluated."
      ),
      buildHumanOverrideBlock([], "")
    ]),
    rejectedAlternatives: buildRejectedAlternatives(report),
    acceptedRisk: buildAcceptedRisk({
      severity: "LOW",
      justification: `Counterfactual report ${report.reportHash} generated.`,
      reviewer: null
    }),
    timestamps: {
      decidedAt,
      recordedAt: decidedAt
    }
  };
}

export function buildDecisionRationaleMarkdown(rationale: DecisionRationale): string {
  const lines: string[] = [];
  lines.push(`# Decision Rationale: ${rationale.decisionId}`);
  lines.push("");
  lines.push(`- Decision Type: ${rationale.decisionType}`);
  lines.push(`- Outcome: ${rationale.outcome}`);
  lines.push(`- Confidence Score: ${rationale.confidenceScore.toFixed(4)}`);
  lines.push(`- Policy Hash: ${rationale.policyHash}`);
  lines.push(`- Trace ID: ${rationale.traceId}`);
  lines.push(`- Decided At: ${rationale.timestamps.decidedAt}`);
  lines.push("");
  lines.push("## Rationale Blocks");
  lines.push("");
  if (!rationale.rationaleBlocks.length) {
    lines.push("- No rationale blocks recorded.");
  } else {
    rationale.rationaleBlocks.forEach((block) => {
      lines.push(`- ${block.type}: ${block.summary}`);
      block.entries.forEach((entry) => lines.push(`  - ${entry}`));
    });
  }
  lines.push("");
  lines.push("## Accepted Risk");
  lines.push("");
  lines.push(`- Severity: ${rationale.acceptedRisk.severity}`);
  lines.push(`- Justification: ${rationale.acceptedRisk.justification}`);
  if (rationale.acceptedRisk.reviewer) {
    lines.push(`- Reviewer: ${rationale.acceptedRisk.reviewer}`);
  }
  if (rationale.acceptedRisk.score !== null && rationale.acceptedRisk.score !== undefined) {
    lines.push(`- Score: ${rationale.acceptedRisk.score}`);
  }
  lines.push("");
  lines.push("## Rejected Alternatives");
  lines.push("");
  if (!rationale.rejectedAlternatives.length) {
    lines.push("- No rejected alternatives recorded.");
  } else {
    rationale.rejectedAlternatives.forEach((entry) => {
      const detail = entry.details ? ` (${entry.details})` : "";
      lines.push(`- ${entry.label}: ${entry.delta}${detail}`);
    });
  }
  return lines.join("\n");
}

import { createPolicyEvaluator, InMemoryRateLimiter } from "../policy-code/evaluator";
import type { CandidatePolicySnapshot } from "../policy-code/loader";
import type { ExecutionMode, PolicyDecision } from "../policy-code/types";
import type { ReplayBaselineIntent } from "../policy-replay/types";
import type { ImpactClassification, ImpactRow, PolicyImpactReport } from "./types";

const DECISION_SEVERITY: Record<PolicyDecision, number> = {
  ALLOW: 0,
  WARN: 1,
  DENY: 2
};

function buildEvaluator(snapshot: CandidatePolicySnapshot, now: () => number) {
  const loader = {
    getSnapshot: () => ({
      policy: snapshot.policy,
      info: snapshot.info,
      source: "loaded" as const
    }),
    reload: () => ({
      policy: snapshot.policy,
      info: snapshot.info,
      source: "loaded" as const
    })
  };
  return createPolicyEvaluator({ loader, limiter: new InMemoryRateLimiter(now) });
}

function normalizeApprovalRoles(roles: string[]): string[] {
  return Array.from(new Set(roles)).sort((a, b) => a.localeCompare(b));
}

function collectApprovalRoles(requiredApprovals: Array<{ role: string }>): string[] {
  return normalizeApprovalRoles(requiredApprovals.map((approval) => approval.role));
}

function detectApprovalChanges(prev: string[], next: string[]): { escalated: boolean; relaxed: boolean } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const escalated = Array.from(nextSet).some((role) => !prevSet.has(role));
  const relaxed = Array.from(prevSet).some((role) => !nextSet.has(role));
  return { escalated, relaxed };
}

function buildClassifications(input: {
  prevDecision: PolicyDecision;
  nextDecision: PolicyDecision;
  prevSeverity: number;
  nextSeverity: number;
  approvals: { escalated: boolean; relaxed: boolean };
}): ImpactClassification[] {
  const classifications: ImpactClassification[] = [];

  if (input.prevDecision !== input.nextDecision) {
    if (input.prevDecision !== "DENY" && input.nextDecision === "DENY") {
      classifications.push("NEWLY_BLOCKED");
    }
    if (input.prevDecision !== "ALLOW" && input.nextDecision === "ALLOW") {
      classifications.push("NEWLY_ALLOWED");
    }
  }

  if (input.approvals.escalated) {
    classifications.push("APPROVAL_ESCALATED");
  }

  if (input.approvals.relaxed) {
    classifications.push("APPROVAL_RELAXED");
  }

  if (input.nextSeverity > input.prevSeverity) {
    classifications.push("SEVERITY_INCREASED");
  } else if (input.nextSeverity < input.prevSeverity) {
    classifications.push("SEVERITY_DECREASED");
  }

  if (classifications.length === 0) {
    classifications.push("UNCHANGED");
  }

  return classifications;
}

function computeBlastRadiusScore(input: {
  newlyBlocked: number;
  approvalEscalations: number;
  severityIncreases: number;
  newlyAllowed: number;
}): number {
  const score =
    input.newlyBlocked * 5 +
    input.approvalEscalations * 3 +
    input.severityIncreases * 2 +
    input.newlyAllowed * 1;
  return Math.min(100, Math.max(0, score));
}

export function computePolicyImpactReport(input: {
  currentPolicy: CandidatePolicySnapshot;
  candidatePolicy: CandidatePolicySnapshot;
  intents: ReplayBaselineIntent[];
  window: { since: Date; until: Date };
  executionMode: ExecutionMode;
}): PolicyImpactReport {
  let currentTime = 0;
  const now = () => currentTime;
  const currentEvaluator = buildEvaluator(input.currentPolicy, now);
  const candidateEvaluator = buildEvaluator(input.candidatePolicy, now);

  let newlyBlocked = 0;
  let newlyAllowed = 0;
  let approvalEscalations = 0;
  let severityIncreases = 0;

  const rows: ImpactRow[] = input.intents.map((intent) => {
    currentTime = intent.createdAt.getTime();

    const prevEvaluation = currentEvaluator.evaluate(intent.intent, {
      executionMode: input.executionMode,
      traceId: intent.traceId
    });
    const nextEvaluation = candidateEvaluator.evaluate(intent.intent, {
      executionMode: input.executionMode,
      traceId: intent.traceId
    });

    const prevApprovalsRequired = collectApprovalRoles(prevEvaluation.requiredApprovals);
    const nextApprovalsRequired = collectApprovalRoles(nextEvaluation.requiredApprovals);
    const prevSeverity = DECISION_SEVERITY[prevEvaluation.final];
    const nextSeverity = DECISION_SEVERITY[nextEvaluation.final];

    const approvalChanges = detectApprovalChanges(prevApprovalsRequired, nextApprovalsRequired);

    const classifications = buildClassifications({
      prevDecision: prevEvaluation.final,
      nextDecision: nextEvaluation.final,
      prevSeverity,
      nextSeverity,
      approvals: approvalChanges
    });

    if (classifications.includes("NEWLY_BLOCKED")) {
      newlyBlocked += 1;
    }
    if (classifications.includes("NEWLY_ALLOWED")) {
      newlyAllowed += 1;
    }
    if (classifications.includes("APPROVAL_ESCALATED")) {
      approvalEscalations += 1;
    }
    if (classifications.includes("SEVERITY_INCREASED")) {
      severityIncreases += 1;
    }

    return {
      intentId: intent.traceId,
      traceId: intent.traceId,
      intentType: intent.intentType,
      prevDecision: prevEvaluation.final,
      nextDecision: nextEvaluation.final,
      prevApprovalsRequired,
      nextApprovalsRequired,
      prevSeverity,
      nextSeverity,
      classifications
    };
  });

  return {
    policyHashCurrent: input.currentPolicy.info.hash,
    policyHashCandidate: input.candidatePolicy.info.hash,
    window: {
      since: input.window.since.toISOString(),
      until: input.window.until.toISOString()
    },
    totals: {
      intentsEvaluated: input.intents.length,
      newlyBlocked,
      newlyAllowed,
      approvalEscalations,
      severityIncreases
    },
    blastRadiusScore: computeBlastRadiusScore({
      newlyBlocked,
      approvalEscalations,
      severityIncreases,
      newlyAllowed
    }),
    rows
  };
}

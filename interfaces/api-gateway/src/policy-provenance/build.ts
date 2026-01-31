import type { PolicyInfo } from "../policy-code/types";
import { buildPolicyEventLog } from "../policy-events/projector";
import { canonicalJson, sha256 } from "../policy-events/hash";
import { buildPolicyDriftReport, defaultDriftWindow } from "../policy-drift/compute";
import type { DriftReport } from "../policy-drift/types";
import { buildPolicyLifecycleTimeline } from "../policy-lifecycle/timeline";
import type { PolicyLifecycleStore } from "../policy-lifecycle/store";
import type { PolicyLineageStore } from "../policy-lineage/store";
import type { PolicyReplayStore } from "../policy-replay/replay-store";
import type { GuardrailCheckStore } from "../policy-promotion-guardrails/store";
import type { PolicyApprovalStore } from "../policy-approvals/store";
import type { PolicyOutcomeStore } from "../policy-outcomes/store";
import type { GuardrailDecision, GuardrailCheckRecord } from "../policy-promotion-guardrails/types";
import type { PolicyApprovalRecord } from "../policy-approvals/types";
import { verifyPolicyDeterminism } from "../policy-verifier/verify";
import type { PolicyImpactReport } from "../policy-impact/types";
import type { PolicyLifecycleTimeline } from "../policy-lifecycle/timeline";
import type { PolicyProvenanceReport, PolicyImpactSimulationSummary, PolicyProvenanceMetadata } from "./types";

const RATE_DECIMALS = 4;

type BuildInput = {
  policyHash: string;
  activePolicyHash: string | null;
  lifecycleStore: PolicyLifecycleStore;
  lineageStore: PolicyLineageStore;
  replayStore: PolicyReplayStore;
  guardrailCheckStore: GuardrailCheckStore;
  approvalStore: PolicyApprovalStore;
  outcomeStore: PolicyOutcomeStore;
  policyInfo?: PolicyInfo;
};

function roundNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return value ?? null;
  }
  return Number(value.toFixed(RATE_DECIMALS));
}

function roundNumberOrZero(value: number | null | undefined): number {
  return roundNumber(value) ?? 0;
}

function normalizeDriftReport(report: DriftReport | null): DriftReport | null {
  if (!report) {
    return null;
  }
  return {
    ...report,
    recent: {
      ...report.recent,
      metrics: {
        ...report.recent.metrics,
        failureRate: roundNumberOrZero(report.recent.metrics.failureRate),
        overrideRate: roundNumberOrZero(report.recent.metrics.overrideRate),
        qualityScore: roundNumberOrZero(report.recent.metrics.qualityScore)
      }
    },
    baseline: {
      ...report.baseline,
      metrics: {
        ...report.baseline.metrics,
        failureRate: roundNumberOrZero(report.baseline.metrics.failureRate),
        overrideRate: roundNumberOrZero(report.baseline.metrics.overrideRate),
        qualityScore: roundNumberOrZero(report.baseline.metrics.qualityScore)
      }
    },
    deltas: {
      ...report.deltas,
      failureRateDelta: roundNumberOrZero(report.deltas.failureRateDelta),
      overrideRateDelta: roundNumberOrZero(report.deltas.overrideRateDelta),
      qualityScoreDelta: roundNumberOrZero(report.deltas.qualityScoreDelta)
    },
    health: {
      ...report.health,
      rationale: report.health.rationale.slice().sort((a, b) => a.localeCompare(b))
    }
  };
}

function normalizeImpactReport(impact: PolicyImpactReport & { impactedIntents: number }) {
  const rows = impact.rows
    .slice()
    .map((row) => ({
      ...row,
      prevApprovalsRequired: row.prevApprovalsRequired.slice().sort((a, b) => a.localeCompare(b)),
      nextApprovalsRequired: row.nextApprovalsRequired.slice().sort((a, b) => a.localeCompare(b)),
      classifications: row.classifications.slice().sort((a, b) => a.localeCompare(b))
    }))
    .sort((a, b) => a.traceId.localeCompare(b.traceId));

  return {
    ...impact,
    blastRadiusScore: roundNumberOrZero(impact.blastRadiusScore),
    rows
  };
}

function normalizeGuardrailDecision(decision: GuardrailDecision): GuardrailDecision {
  return {
    ...decision,
    reasons: decision.reasons.slice().sort((a, b) => a.code.localeCompare(b.code)),
    snapshot: {
      ...decision.snapshot,
      drift: normalizeDriftReport(decision.snapshot.drift) as DriftReport,
      impact: normalizeImpactReport(decision.snapshot.impact),
      quality: {
        ...decision.snapshot.quality,
        failureRate: roundNumberOrZero(decision.snapshot.quality.failureRate),
        overrideRate: roundNumberOrZero(decision.snapshot.quality.overrideRate),
        weightedPenalty: roundNumberOrZero(decision.snapshot.quality.weightedPenalty),
        qualityScore: roundNumberOrZero(decision.snapshot.quality.qualityScore),
        score: roundNumberOrZero(decision.snapshot.quality.score)
      }
    }
  };
}

function normalizeGuardrailChecks(checks: GuardrailCheckRecord[]): GuardrailCheckRecord[] {
  return checks
    .slice()
    .map((check) => ({
      ...check,
      decision: normalizeGuardrailDecision(check.decision)
    }))
    .sort((a, b) => {
      if (a.evaluatedAt !== b.evaluatedAt) {
        return a.evaluatedAt.localeCompare(b.evaluatedAt);
      }
      return a.id.localeCompare(b.id);
    });
}

function normalizeApprovals(approvals: PolicyApprovalRecord[]): PolicyApprovalRecord[] {
  return approvals
    .slice()
    .map((approval) => ({
      ...approval,
      acceptedRiskScore: roundNumber(approval.acceptedRiskScore) ?? null
    }))
    .sort((a, b) => {
      if (a.approvedAt !== b.approvedAt) {
        return a.approvedAt.localeCompare(b.approvedAt);
      }
      if (a.approvedBy !== b.approvedBy) {
        return a.approvedBy.localeCompare(b.approvedBy);
      }
      return a.id.localeCompare(b.id);
    });
}

function normalizeTimeline(timeline: PolicyLifecycleTimeline): PolicyLifecycleTimeline {
  return {
    state: timeline.state,
    events: timeline.events
      .slice()
      .sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
          return a.timestamp.localeCompare(b.timestamp);
        }
        if (a.type !== b.type) {
          return a.type.localeCompare(b.type);
        }
        if (a.actor !== b.actor) {
          return a.actor.localeCompare(b.actor);
        }
        return a.rationale.localeCompare(b.rationale);
      })
  };
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  return time;
}

function resolveAsOfTimestamp(values: Array<string | null | undefined>): string {
  const timestamps = values
    .map((value) => parseTimestamp(value))
    .filter((value): value is number => value !== null);
  if (!timestamps.length) {
    return new Date(0).toISOString();
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

function buildMetadata(input: {
  policyHash: string;
  status: ReturnType<PolicyLifecycleStore["getStatus"]>;
  policyInfo?: PolicyInfo;
  activePolicyHash: string | null;
}): PolicyProvenanceMetadata {
  const status = input.status;
  const usePolicyInfo = input.policyInfo && input.activePolicyHash === input.policyHash;
  return {
    policyHash: input.policyHash,
    lifecycleState: status?.state ?? null,
    statusUpdatedAt: status?.updatedAt ?? null,
    version: status?.version ?? (usePolicyInfo ? input.policyInfo?.version ?? null : null),
    path: status?.path ?? (usePolicyInfo ? input.policyInfo?.path ?? null : null),
    source: status?.source ?? null,
    ref: status?.ref ?? null,
    inlineYaml: status?.inlineYaml ?? null,
    loadedAt: status?.loadedAt ?? (usePolicyInfo ? input.policyInfo?.loadedAt ?? null : null)
  };
}

function buildImpactSummary(checks: GuardrailCheckRecord[]): PolicyImpactSimulationSummary | null {
  if (!checks.length) {
    return null;
  }
  const latest = checks[checks.length - 1];
  const impact = normalizeImpactReport(latest.decision.snapshot.impact);
  return {
    evaluatedAt: latest.evaluatedAt,
    policyHashCurrent: impact.policyHashCurrent,
    policyHashCandidate: impact.policyHashCandidate,
    window: impact.window,
    totals: {
      ...impact.totals,
      impactedIntents: impact.impactedIntents
    },
    blastRadiusScore: impact.blastRadiusScore
  };
}

function normalizeDeterminismResult(result: PolicyProvenanceReport["determinism"]) {
  return {
    ...result,
    mismatches: result.mismatches.slice().sort((a, b) => a.field.localeCompare(b.field))
  };
}

export async function buildPolicyProvenanceReport(input: BuildInput): Promise<PolicyProvenanceReport> {
  const status = input.lifecycleStore.getStatus(input.policyHash);
  const activePolicyHash = input.activePolicyHash ?? input.lifecycleStore.getActivePolicy()?.policyHash ?? null;

  const [lineage, activeLineageChain, simulations, guardrailChecksRaw, approvalsRaw, events] = await Promise.all([
    input.lineageStore.getLineage(input.policyHash),
    activePolicyHash ? input.lineageStore.getLineageChain(activePolicyHash) : Promise.resolve([]),
    input.replayStore.listRuns({ policyHash: input.policyHash, limit: 200 }),
    input.guardrailCheckStore.listChecks(input.policyHash),
    input.approvalStore.listApprovals(input.policyHash),
    buildPolicyEventLog({
      policyHash: input.policyHash,
      limit: 500,
      stores: {
        replayStore: input.replayStore,
        outcomeStore: input.outcomeStore,
        guardrailCheckStore: input.guardrailCheckStore,
        approvalStore: input.approvalStore,
        lineageStore: input.lineageStore
      }
    })
  ]);

  const timeline = normalizeTimeline(
    buildPolicyLifecycleTimeline({
      policyHash: input.policyHash,
      activePolicyHash,
      lineage,
      activeLineageChain,
      simulations,
      guardrailChecks: guardrailChecksRaw,
      approvals: approvalsRaw
    })
  );

  const guardrailChecks = normalizeGuardrailChecks(guardrailChecksRaw);
  const approvals = normalizeApprovals(approvalsRaw);

  const asOf = resolveAsOfTimestamp([
    status?.updatedAt,
    status?.loadedAt,
    lineage?.promotedAt,
    ...simulations.map((run) => run.createdAt.toISOString()),
    ...guardrailChecks.map((check) => check.evaluatedAt),
    ...approvals.map((approval) => approval.approvedAt),
    ...events.map((event) => event.occurredAt)
  ]);

  const driftWindows = defaultDriftWindow(new Date(asOf));
  const driftReport = normalizeDriftReport(
    await buildPolicyDriftReport({
      policyHash: input.policyHash,
      recentWindow: driftWindows.recent,
      baselineWindow: driftWindows.baseline,
      outcomeStore: input.outcomeStore,
      replayStore: input.replayStore,
      lineageStore: input.lineageStore
    })
  );

  const determinism = normalizeDeterminismResult(
    await verifyPolicyDeterminism({
      policyHash: input.policyHash,
      activePolicyHash,
      now: new Date(asOf),
      events,
      stores: {
        replayStore: input.replayStore,
        outcomeStore: input.outcomeStore,
        lineageStore: input.lineageStore,
        guardrailCheckStore: input.guardrailCheckStore,
        approvalStore: input.approvalStore
      }
    })
  );

  const reportBase = {
    policyHash: input.policyHash,
    asOf,
    metadata: buildMetadata({
      policyHash: input.policyHash,
      status,
      policyInfo: input.policyInfo,
      activePolicyHash
    }),
    lifecycle: timeline,
    guardrailChecks,
    approvals,
    driftReport,
    impactSimulationSummary: buildImpactSummary(guardrailChecks),
    determinism
  } satisfies Omit<PolicyProvenanceReport, "reportHash">;

  const reportHash = sha256(canonicalJson(reportBase));

  return {
    ...reportBase,
    reportHash
  };
}

export function buildPolicyProvenanceMarkdown(report: PolicyProvenanceReport): string {
  const lines: string[] = [];
  lines.push("# Policy Provenance Report");
  lines.push("");
  lines.push(`- Policy Hash: ${report.policyHash}`);
  lines.push(`- Report Hash: ${report.reportHash}`);
  lines.push(`- As Of: ${report.asOf}`);
  lines.push(`- Lifecycle State: ${report.lifecycle.state}`);
  lines.push(`- Determinism Verified: ${report.determinism.verified ? "Yes" : "No"}`);
  lines.push("");
  lines.push("## Metadata");
  lines.push("");
  lines.push(`- Status State: ${report.metadata.lifecycleState ?? "unknown"}`);
  lines.push(`- Status Updated At: ${report.metadata.statusUpdatedAt ?? "n/a"}`);
  lines.push(`- Version: ${report.metadata.version ?? "n/a"}`);
  lines.push(`- Path: ${report.metadata.path ?? "n/a"}`);
  lines.push(`- Source: ${report.metadata.source ?? "n/a"}`);
  lines.push(`- Ref: ${report.metadata.ref ?? "n/a"}`);
  lines.push(`- Loaded At: ${report.metadata.loadedAt ?? "n/a"}`);
  lines.push("");
  lines.push("## Lifecycle Timeline");
  lines.push("");
  if (!report.lifecycle.events.length) {
    lines.push("- No lifecycle events recorded.");
  } else {
    report.lifecycle.events.forEach((event) => {
      lines.push(`- ${event.timestamp} · ${event.type} · ${event.actor}: ${event.rationale}`);
    });
  }
  lines.push("");
  lines.push("## Guardrail Checks");
  lines.push("");
  lines.push(`- Total Checks: ${report.guardrailChecks.length}`);
  if (report.guardrailChecks.length) {
    const lastCheck = report.guardrailChecks[report.guardrailChecks.length - 1];
    lines.push(`- Latest Check: ${lastCheck.evaluatedAt} · ${lastCheck.actor}`);
    lines.push(`- Latest Decision Allowed: ${lastCheck.decision.allowed ? "Yes" : "No"}`);
  }
  lines.push("");
  lines.push("## Approvals");
  lines.push("");
  lines.push(`- Total Approvals: ${report.approvals.length}`);
  lines.push("");
  lines.push("## Drift Report");
  lines.push("");
  if (!report.driftReport) {
    lines.push("- Drift report unavailable.");
  } else {
    lines.push(`- Health State: ${report.driftReport.health.state}`);
    lines.push(`- Recent Window: ${report.driftReport.recent.window.since} → ${report.driftReport.recent.window.until}`);
    lines.push(`- Baseline Window: ${report.driftReport.baseline.window.since} → ${report.driftReport.baseline.window.until}`);
  }
  lines.push("");
  lines.push("## Impact Simulation Summary");
  lines.push("");
  if (!report.impactSimulationSummary) {
    lines.push("- No impact simulation summary available.");
  } else {
    lines.push(`- Evaluated At: ${report.impactSimulationSummary.evaluatedAt}`);
    lines.push(`- Candidate Policy Hash: ${report.impactSimulationSummary.policyHashCandidate}`);
    lines.push(`- Blast Radius Score: ${report.impactSimulationSummary.blastRadiusScore}`);
    lines.push(`- Intents Evaluated: ${report.impactSimulationSummary.totals.intentsEvaluated}`);
  }
  lines.push("");
  lines.push("## Determinism Verification");
  lines.push("");
  lines.push(`- Verified: ${report.determinism.verified ? "Yes" : "No"}`);
  lines.push(`- Event Count: ${report.determinism.eventCount}`);
  lines.push(`- Last Event Hash: ${report.determinism.lastEventHash ?? "n/a"}`);
  lines.push(`- Drift Window (Recent): ${report.determinism.windows.drift.recent.since} → ${report.determinism.windows.drift.recent.until}`);
  lines.push(`- Drift Window (Baseline): ${report.determinism.windows.drift.baseline.since} → ${report.determinism.windows.drift.baseline.until}`);
  if (report.determinism.windows.quality) {
    lines.push(`- Quality Window: ${report.determinism.windows.quality.since} → ${report.determinism.windows.quality.until}`);
  }

  return lines.join("\n");
}

import { afterEach, expect, test, vi } from "vitest";
import { InMemoryPolicyLifecycleStore } from "../src/policy-lifecycle/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryGuardrailCheckStore } from "../src/policy-promotion-guardrails/store";
import { InMemoryPolicyApprovalStore } from "../src/policy-approvals/store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyRollbackStore } from "../src/policy-rollback/store";
import { buildPolicyProvenanceReport } from "../src/policy-provenance/build";
import type { DriftReport } from "../src/policy-drift/types";
import type { PolicyImpactReport } from "../src/policy-impact/types";

const policyHash = "policy-123";

function buildGuardrailDecision(): {
  policyHash: string;
  evaluatedAt: string;
  drift: DriftReport;
  impact: PolicyImpactReport & { impactedIntents: number };
  quality: {
    totalOutcomes: number;
    failureRate: number;
    overrideRate: number;
    weightedPenalty: number;
    qualityScore: number;
    score: number;
  };
} {
  const drift: DriftReport = {
    policyHash,
    recent: {
      window: { since: "2024-03-25T00:00:00.000Z", until: "2024-04-01T00:00:00.000Z" },
      metrics: {
        totalOutcomes: 10,
        failureRate: 0.1,
        overrideRate: 0.05,
        qualityScore: 98.76543,
        replayAdded: 2,
        replayRemoved: 1
      }
    },
    baseline: {
      window: { since: "2024-02-01T00:00:00.000Z", until: "2024-03-01T00:00:00.000Z" },
      metrics: {
        totalOutcomes: 20,
        failureRate: 0.2,
        overrideRate: 0.02,
        qualityScore: 95.4321,
        replayAdded: 0,
        replayRemoved: 0
      }
    },
    deltas: {
      failureRateDelta: -0.1,
      overrideRateDelta: 0.03,
      qualityScoreDelta: 3.3333,
      replayDelta: 3
    },
    health: {
      state: "HEALTHY",
      rationale: []
    }
  };

  const impact: PolicyImpactReport & { impactedIntents: number } = {
    policyHashCurrent: "base-1",
    policyHashCandidate: policyHash,
    window: { since: "2024-03-15T00:00:00.000Z", until: "2024-04-01T00:00:00.000Z" },
    totals: {
      intentsEvaluated: 12,
      newlyBlocked: 1,
      newlyAllowed: 2,
      approvalEscalations: 0,
      severityIncreases: 1
    },
    blastRadiusScore: 12.34567,
    rows: [],
    impactedIntents: 3
  };

  return {
    policyHash,
    evaluatedAt: "2024-04-04T09:00:00.000Z",
    drift,
    impact,
    quality: {
      totalOutcomes: 30,
      failureRate: 0.123456,
      overrideRate: 0.05,
      weightedPenalty: 0.2,
      qualityScore: 88.88888,
      score: 88.88888
    }
  };
}

async function seedStores() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-04-01T00:00:00.000Z"));

  const lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-04-01T00:00:00.000Z"));
  lifecycleStore.registerDraft({
    hash: policyHash,
    source: "inline",
    ref: "inline",
    inlineYaml: "version: \"v1\"\n"
  });

  const lineageStore = new InMemoryPolicyLineageStore();
  await lineageStore.createLineage({
    policyHash,
    parentPolicyHash: null,
    promotedBy: "release-bot",
    promotedAt: "2024-04-05T12:00:00.000Z",
    rationale: "Approved promotion",
    acceptedRiskScore: 0.333333,
    source: "manual",
    drift: {
      constraintsAdded: 1,
      constraintsRemoved: 0,
      severityDelta: 0.125555,
      netRiskScoreChange: 0.22222
    }
  });

  const replayStore = new InMemoryPolicyReplayStore();
  vi.setSystemTime(new Date("2024-04-02T10:00:00.000Z"));
  const run = await replayStore.createRun({
    baselinePolicyHash: "base-1",
    candidatePolicyHash: policyHash,
    candidatePolicySource: "current",
    limit: 1
  });
  await replayStore.saveResults(run.id, [
    {
      id: "result-1",
      runId: run.id,
      traceId: "trace-1",
      intentType: "CREATE_PO",
      baselineDecision: "ALLOW",
      candidateDecision: "DENY",
      changed: true,
      baselinePolicyHash: "base-1",
      candidatePolicyHash: policyHash,
      baselineMatchedRules: ["rule-1"],
      candidateMatchedRules: ["rule-2"],
      candidateConstraintTypes: [],
      baselineRisk: { level: "low", signals: [] },
      reasons: [],
      categories: [],
      risk: { level: "low", signals: [] },
      createdAt: new Date("2024-04-02T10:05:00.000Z")
    }
  ]);

  const outcomeStore = new InMemoryPolicyOutcomeStore();
  await outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash,
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: new Date("2024-04-03T11:00:00.000Z")
  });

  const approvalStore = new InMemoryPolicyApprovalStore();
  vi.setSystemTime(new Date("2024-04-04T08:00:00.000Z"));
  await approvalStore.recordApproval({
    policyHash,
    approvedBy: "risk-team",
    approvedAt: "2024-04-04T08:00:00.000Z",
    rationale: "Guardrails satisfied",
    acceptedRiskScore: 0.123456,
    notes: null,
    runId: run.id
  });

  const guardrailCheckStore = new InMemoryGuardrailCheckStore();
  vi.setSystemTime(new Date("2024-04-04T09:00:00.000Z"));
  const guardrailSnapshot = buildGuardrailDecision();
  await guardrailCheckStore.recordCheck({
    policyHash,
    evaluatedAt: guardrailSnapshot.evaluatedAt,
    actor: "reviewer",
    rationale: "All checks passed",
    decision: {
      allowed: true,
      requiredAcceptance: false,
      reasons: [],
      snapshot: {
        policyHash: guardrailSnapshot.policyHash,
        evaluatedAt: guardrailSnapshot.evaluatedAt,
        drift: guardrailSnapshot.drift,
        impact: guardrailSnapshot.impact,
        quality: guardrailSnapshot.quality,
        lineageHead: null
      }
    }
  });

  const rollbackStore = new InMemoryPolicyRollbackStore();

  return {
    lifecycleStore,
    lineageStore,
    replayStore,
    guardrailCheckStore,
    approvalStore,
    outcomeStore,
    rollbackStore
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test("builds a deterministic provenance report with ordered sections", async () => {
  const stores = await seedStores();

  const report = await buildPolicyProvenanceReport({
    policyHash,
    activePolicyHash: policyHash,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore,
    replayStore: stores.replayStore,
    guardrailCheckStore: stores.guardrailCheckStore,
    approvalStore: stores.approvalStore,
    outcomeStore: stores.outcomeStore,
    rollbackStore: stores.rollbackStore
  });

  expect(report.policyHash).toBe(policyHash);
  expect(report.lifecycle.events[0]?.type).toBe("simulation");
  expect(report.guardrailChecks).toHaveLength(1);
  expect(report.approvals[0]?.approvedBy).toBe("risk-team");
  expect(report.lastRollback).toBeNull();
  expect(report.impactSimulationSummary?.blastRadiusScore).toBe(12.3457);
  expect(report.determinism.verified).toBe(true);
  expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/);
});

test("rollbacks are included in provenance timelines", async () => {
  const stores = await seedStores();

  await stores.rollbackStore.recordRollback({
    eventType: "ROLLBACK",
    eventHash: "rollback-1",
    fromPolicyHash: "policy-456",
    toPolicyHash: policyHash,
    actor: "release-manager",
    rationale: "Rollback after regression.",
    createdAt: "2024-04-06T09:00:00.000Z"
  });

  const report = await buildPolicyProvenanceReport({
    policyHash,
    activePolicyHash: policyHash,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore,
    replayStore: stores.replayStore,
    guardrailCheckStore: stores.guardrailCheckStore,
    approvalStore: stores.approvalStore,
    outcomeStore: stores.outcomeStore,
    rollbackStore: stores.rollbackStore
  });

  expect(report.lastRollback?.eventHash).toBe("rollback-1");
  expect(report.lifecycle.events.some((event) => event.type === "rollback")).toBe(true);
});

test("produces a stable report hash across builds", async () => {
  const stores = await seedStores();

  const first = await buildPolicyProvenanceReport({
    policyHash,
    activePolicyHash: policyHash,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore,
    replayStore: stores.replayStore,
    guardrailCheckStore: stores.guardrailCheckStore,
    approvalStore: stores.approvalStore,
    outcomeStore: stores.outcomeStore,
    rollbackStore: stores.rollbackStore
  });

  const second = await buildPolicyProvenanceReport({
    policyHash,
    activePolicyHash: policyHash,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore,
    replayStore: stores.replayStore,
    guardrailCheckStore: stores.guardrailCheckStore,
    approvalStore: stores.approvalStore,
    outcomeStore: stores.outcomeStore,
    rollbackStore: stores.rollbackStore
  });

  expect(second.reportHash).toBe(first.reportHash);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { InMemoryPolicyLifecycleStore } from "../src/policy-lifecycle/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryGuardrailCheckStore } from "../src/policy-promotion-guardrails/store";
import { InMemoryPolicyApprovalStore } from "../src/policy-approvals/store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyRollbackStore } from "../src/policy-rollback/store";
import { InMemoryDecisionRationaleStore } from "../src/decision-rationale/store";
import { buildTrustReport } from "../src/trust-report/build";
import { canonicalJson, sha256 } from "../src/policy-events/hash";
import type { DecisionRationale } from "../src/decision-rationale/types";

const fixturesDir = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(fixturesDir, "fixtures", "trust-report.golden.json");

const policyHash = "policy-123";
const baselinePolicyHash = "policy-001";
const now = new Date("2024-04-10T12:00:00.000Z");

function buildStores() {
  const lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date(now));
  const lineageStore = new InMemoryPolicyLineageStore();
  const replayStore = new InMemoryPolicyReplayStore();
  const guardrailCheckStore = new InMemoryGuardrailCheckStore();
  const approvalStore = new InMemoryPolicyApprovalStore();
  const outcomeStore = new InMemoryPolicyOutcomeStore();
  const rollbackStore = new InMemoryPolicyRollbackStore();
  const decisionRationaleStore = new InMemoryDecisionRationaleStore();

  return {
    lifecycleStore,
    lineageStore,
    replayStore,
    guardrailCheckStore,
    approvalStore,
    outcomeStore,
    rollbackStore,
    decisionRationaleStore
  };
}

async function seedStores() {
  const stores = buildStores();

  stores.lifecycleStore.setActivePolicy({
    hash: policyHash,
    version: "v1",
    path: "policies/policy.yaml",
    loadedAt: "2024-04-10T00:00:00.000Z"
  });

  await stores.lineageStore.createLineage({
    policyHash,
    parentPolicyHash: "policy-122",
    promotedBy: "system",
    promotedAt: "2024-04-09T08:00:00.000Z",
    rationale: "Baseline promotion.",
    acceptedRiskScore: 0.2,
    source: "replay",
    drift: {
      constraintsAdded: 2,
      constraintsRemoved: 1,
      severityDelta: 0.1,
      netRiskScoreChange: 0.05
    }
  });

  await stores.rollbackStore.recordRollback({
    eventType: "ROLLBACK",
    eventHash: "rollback-hash-1",
    fromPolicyHash: "policy-122",
    toPolicyHash: policyHash,
    actor: "system",
    rationale: "Rollback executed.",
    createdAt: "2024-04-09T10:00:00.000Z"
  });

  const decision: DecisionRationale = {
    decisionId: "decision-1",
    traceId: "trace-1",
    policyHash,
    decisionType: "EXECUTION",
    outcome: "ALLOW",
    confidenceScore: 0.82,
    rationaleBlocks: [],
    rejectedAlternatives: [],
    acceptedRisk: {
      severity: "LOW",
      justification: "Within baseline guardrails.",
      reviewer: null,
      score: 0.1
    },
    timestamps: {
      decidedAt: "2024-04-09T12:00:00.000Z",
      recordedAt: "2024-04-09T12:00:00.000Z"
    }
  };

  await stores.decisionRationaleStore.recordDecisionRationale(decision);

  const outcomeA = await stores.outcomeStore.recordOutcome({
    traceId: "trace-a",
    intentType: "CREATE_PO",
    policyHash,
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: new Date("2024-03-10T12:00:00.000Z")
  });
  outcomeA.id = "outcome-1";

  const outcomeB = await stores.outcomeStore.recordOutcome({
    traceId: "trace-b",
    intentType: "CREATE_PO",
    policyHash,
    decision: "WARN",
    outcomeType: "override",
    severity: 2,
    humanOverride: true,
    observedAt: new Date("2024-03-20T12:00:00.000Z")
  });
  outcomeB.id = "outcome-2";

  const outcomeC = await stores.outcomeStore.recordOutcome({
    traceId: "trace-c",
    intentType: "CHECK_INVENTORY",
    policyHash,
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: new Date("2024-04-05T12:00:00.000Z")
  });
  outcomeC.id = "outcome-3";

  const outcomeD = await stores.outcomeStore.recordOutcome({
    traceId: "trace-d",
    intentType: "REVIEW_INVOICE",
    policyHash,
    decision: "DENY",
    outcomeType: "rollback",
    severity: 4,
    humanOverride: false,
    observedAt: new Date("2024-04-08T12:00:00.000Z")
  });
  outcomeD.id = "outcome-4";

  const outcomeE = await stores.outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash: baselinePolicyHash,
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: new Date("2024-04-01T12:00:00.000Z")
  });
  outcomeE.id = "outcome-5";

  const outcomeF = await stores.outcomeStore.recordOutcome({
    traceId: "trace-2",
    intentType: "REVIEW_INVOICE",
    policyHash: baselinePolicyHash,
    decision: "WARN",
    outcomeType: "override",
    severity: 2,
    humanOverride: true,
    observedAt: new Date("2024-04-02T12:00:00.000Z")
  });
  outcomeF.id = "outcome-6";

  const run = await stores.replayStore.createRun({
    baselinePolicyHash,
    candidatePolicyHash: policyHash,
    candidatePolicySource: "inline",
    candidatePolicyRef: null,
    limit: 2,
    since: new Date("2024-04-01T12:00:00.000Z"),
    until: new Date("2024-04-02T12:00:00.000Z")
  });
  run.id = "run-1";
  run.createdAt = new Date("2024-04-02T12:00:00.000Z");

  await stores.replayStore.saveResults(run.id, [
    {
      id: "result-1",
      traceId: "trace-1",
      intentType: "CREATE_PO",
      baselineDecision: "ALLOW",
      baselineMatchedRules: [],
      baselinePolicyHash,
      baselineRisk: { level: "low", signals: [] },
      candidateDecision: "WARN",
      candidateMatchedRules: [],
      candidateConstraintTypes: [],
      candidatePolicyHash: policyHash,
      candidateRisk: { level: "medium", signals: [] },
      reasons: [],
      categories: [],
      risk: { level: "medium", signals: [] },
      changed: true,
      createdAt: new Date("2024-04-02T12:00:00.000Z")
    },
    {
      id: "result-2",
      traceId: "trace-2",
      intentType: "REVIEW_INVOICE",
      baselineDecision: "WARN",
      baselineMatchedRules: [],
      baselinePolicyHash,
      baselineRisk: { level: "medium", signals: [] },
      candidateDecision: "DENY",
      candidateMatchedRules: [],
      candidateConstraintTypes: [],
      candidatePolicyHash: policyHash,
      candidateRisk: { level: "high", signals: [] },
      reasons: [],
      categories: [],
      risk: { level: "high", signals: [] },
      changed: true,
      createdAt: new Date("2024-04-02T12:05:00.000Z")
    }
  ]);

  return stores;
}

afterEach(() => {
  vi.useRealTimers();
});

test("trust score is deterministic", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const stores = await seedStores();

  const reportA = await buildTrustReport({
    policyHash,
    activePolicyHash: policyHash,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore,
    replayStore: stores.replayStore,
    guardrailCheckStore: stores.guardrailCheckStore,
    approvalStore: stores.approvalStore,
    outcomeStore: stores.outcomeStore,
    rollbackStore: stores.rollbackStore,
    decisionRationaleStore: stores.decisionRationaleStore,
    policyInfo: {
      hash: policyHash,
      version: "v1",
      path: "policies/policy.yaml",
      loadedAt: "2024-04-10T00:00:00.000Z"
    }
  });

  const reportB = await buildTrustReport({
    policyHash,
    activePolicyHash: policyHash,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore,
    replayStore: stores.replayStore,
    guardrailCheckStore: stores.guardrailCheckStore,
    approvalStore: stores.approvalStore,
    outcomeStore: stores.outcomeStore,
    rollbackStore: stores.rollbackStore,
    decisionRationaleStore: stores.decisionRationaleStore,
    policyInfo: {
      hash: policyHash,
      version: "v1",
      path: "policies/policy.yaml",
      loadedAt: "2024-04-10T00:00:00.000Z"
    }
  });

  expect(reportA.overallTrustScore).toBe(reportB.overallTrustScore);
  expect(reportA.provenanceHash).toBe(reportB.provenanceHash);
});

test("builds a stable trust report snapshot", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const stores = await seedStores();

  const report = await buildTrustReport({
    policyHash,
    activePolicyHash: policyHash,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore,
    replayStore: stores.replayStore,
    guardrailCheckStore: stores.guardrailCheckStore,
    approvalStore: stores.approvalStore,
    outcomeStore: stores.outcomeStore,
    rollbackStore: stores.rollbackStore,
    decisionRationaleStore: stores.decisionRationaleStore,
    policyInfo: {
      hash: policyHash,
      version: "v1",
      path: "policies/policy.yaml",
      loadedAt: "2024-04-10T00:00:00.000Z"
    }
  });

  const payload = {
    report,
    trustReportHash: sha256(canonicalJson(report))
  };

  const expected = JSON.parse(readFileSync(goldenPath, "utf-8")) as unknown;
  expect(payload).toEqual(expected);
});

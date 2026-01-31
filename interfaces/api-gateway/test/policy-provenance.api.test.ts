import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import type { PolicyLifecycleStore } from "../src/policy-lifecycle/store";
import { InMemoryPolicyLifecycleStore } from "../src/policy-lifecycle/store";
import type { PolicyLineageStore } from "../src/policy-lineage/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import type { PolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import type { GuardrailCheckStore } from "../src/policy-promotion-guardrails/store";
import { InMemoryGuardrailCheckStore } from "../src/policy-promotion-guardrails/store";
import type { PolicyApprovalStore } from "../src/policy-approvals/store";
import { InMemoryPolicyApprovalStore } from "../src/policy-approvals/store";
import type { PolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import type { PolicyRollbackStore } from "../src/policy-rollback/store";
import { InMemoryPolicyRollbackStore } from "../src/policy-rollback/store";
import type { DecisionRationaleStore } from "../src/decision-rationale/store";
import { InMemoryDecisionRationaleStore } from "../src/decision-rationale/store";
import type { DriftReport } from "../src/policy-drift/types";
import type { PolicyImpactReport } from "../src/policy-impact/types";

const stores = vi.hoisted(() => ({
  lifecycleStore: null as PolicyLifecycleStore | null,
  lineageStore: null as PolicyLineageStore | null,
  replayStore: null as PolicyReplayStore | null,
  guardrailCheckStore: null as GuardrailCheckStore | null,
  approvalStore: null as PolicyApprovalStore | null,
  outcomeStore: null as PolicyOutcomeStore | null,
  rollbackStore: null as PolicyRollbackStore | null,
  decisionRationaleStore: null as DecisionRationaleStore | null
}));

vi.mock("../src/policy-lifecycle/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lifecycle/store")>(
    "../src/policy-lifecycle/store"
  );
  return {
    ...actual,
    createPolicyLifecycleStore: () => stores.lifecycleStore as PolicyLifecycleStore
  };
});

vi.mock("../src/policy-lineage/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lineage/store")>("../src/policy-lineage/store");
  return {
    ...actual,
    createPolicyLineageStore: () => stores.lineageStore as PolicyLineageStore
  };
});

vi.mock("../src/policy-replay/replay-store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-replay/replay-store")>(
    "../src/policy-replay/replay-store"
  );
  return {
    ...actual,
    createPolicyReplayStore: () => stores.replayStore as PolicyReplayStore
  };
});

vi.mock("../src/policy-promotion-guardrails/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-promotion-guardrails/store")>(
    "../src/policy-promotion-guardrails/store"
  );
  return {
    ...actual,
    createPolicyGuardrailCheckStore: () => stores.guardrailCheckStore as GuardrailCheckStore
  };
});

vi.mock("../src/policy-approvals/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-approvals/store")>("../src/policy-approvals/store");
  return {
    ...actual,
    createPolicyApprovalStore: () => stores.approvalStore as PolicyApprovalStore
  };
});

vi.mock("../src/policy-outcomes/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-outcomes/store")>("../src/policy-outcomes/store");
  return {
    ...actual,
    createPolicyOutcomeStore: () => stores.outcomeStore as PolicyOutcomeStore
  };
});

vi.mock("../src/policy-rollback/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-rollback/store")>("../src/policy-rollback/store");
  return {
    ...actual,
    createPolicyRollbackStore: () => stores.rollbackStore as PolicyRollbackStore
  };
});

vi.mock("../src/decision-rationale/store", async () => {
  const actual = await vi.importActual<typeof import("../src/decision-rationale/store")>(
    "../src/decision-rationale/store"
  );
  return {
    ...actual,
    createDecisionRationaleStore: () => stores.decisionRationaleStore as DecisionRationaleStore
  };
});

async function buildApp() {
  const { registerRoutes } = await import("../src/routes");
  const app = Fastify();
  await registerRoutes(app);
  await app.ready();
  return app;
}

function buildGuardrailSnapshot(policyHash: string) {
  const drift: DriftReport = {
    policyHash,
    recent: {
      window: { since: "2024-03-25T00:00:00.000Z", until: "2024-04-01T00:00:00.000Z" },
      metrics: {
        totalOutcomes: 5,
        failureRate: 0.1,
        overrideRate: 0.0,
        qualityScore: 98.7654,
        replayAdded: 0,
        replayRemoved: 0
      }
    },
    baseline: {
      window: { since: "2024-02-01T00:00:00.000Z", until: "2024-03-01T00:00:00.000Z" },
      metrics: {
        totalOutcomes: 10,
        failureRate: 0.15,
        overrideRate: 0.05,
        qualityScore: 95.4321,
        replayAdded: 0,
        replayRemoved: 0
      }
    },
    deltas: {
      failureRateDelta: -0.05,
      overrideRateDelta: -0.05,
      qualityScoreDelta: 3.3333,
      replayDelta: 0
    },
    health: { state: "HEALTHY", rationale: [] }
  };

  const impact: PolicyImpactReport & { impactedIntents: number } = {
    policyHashCurrent: "base-1",
    policyHashCandidate: policyHash,
    window: { since: "2024-03-15T00:00:00.000Z", until: "2024-04-01T00:00:00.000Z" },
    totals: {
      intentsEvaluated: 5,
      newlyBlocked: 0,
      newlyAllowed: 1,
      approvalEscalations: 0,
      severityIncreases: 0
    },
    blastRadiusScore: 7.7777,
    rows: [],
    impactedIntents: 1
  };

  return { drift, impact };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});

test("returns provenance report with markdown export", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-04-01T00:00:00.000Z"));

  const policyHash = "policy-123";
  const lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-04-01T00:00:00.000Z"));
  lifecycleStore.registerDraft({ hash: policyHash, source: "inline", ref: "inline", inlineYaml: "version: \"v1\"\n" });

  const lineageStore = new InMemoryPolicyLineageStore();
  await lineageStore.createLineage({
    policyHash,
    parentPolicyHash: null,
    promotedBy: "release-bot",
    promotedAt: "2024-04-05T12:00:00.000Z",
    rationale: "Approved promotion",
    acceptedRiskScore: 0.25,
    source: "manual",
    drift: {
      constraintsAdded: 1,
      constraintsRemoved: 0,
      severityDelta: 0.1,
      netRiskScoreChange: 0.2
    }
  });

  const replayStore = new InMemoryPolicyReplayStore();
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
  const rollbackStore = new InMemoryPolicyRollbackStore();
  const decisionRationaleStore = new InMemoryDecisionRationaleStore();
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
  await approvalStore.recordApproval({
    policyHash,
    approvedBy: "risk-team",
    approvedAt: "2024-04-04T08:00:00.000Z",
    rationale: "Guardrails satisfied",
    acceptedRiskScore: 0.1234,
    notes: null,
    runId: run.id
  });

  const guardrailCheckStore = new InMemoryGuardrailCheckStore();
  const { drift, impact } = buildGuardrailSnapshot(policyHash);
  await guardrailCheckStore.recordCheck({
    policyHash,
    evaluatedAt: "2024-04-04T09:00:00.000Z",
    actor: "reviewer",
    rationale: "All checks passed",
    decision: {
      allowed: true,
      requiredAcceptance: false,
      reasons: [],
      snapshot: {
        policyHash,
        evaluatedAt: "2024-04-04T09:00:00.000Z",
        drift,
        impact,
        quality: {
          totalOutcomes: 15,
          failureRate: 0.1,
          overrideRate: 0.02,
          weightedPenalty: 0.2,
          qualityScore: 90.5,
          score: 90.5
        },
        lineageHead: null
      }
    }
  });

  stores.lifecycleStore = lifecycleStore;
  stores.lineageStore = lineageStore;
  stores.replayStore = replayStore;
  stores.guardrailCheckStore = guardrailCheckStore;
  stores.approvalStore = approvalStore;
  stores.outcomeStore = outcomeStore;
  stores.rollbackStore = rollbackStore;
  stores.decisionRationaleStore = decisionRationaleStore;

  const app = await buildApp();

  const response = await app.inject({
    method: "GET",
    url: `/v1/policy/provenance?policyHash=${policyHash}`
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.report.policyHash).toBe(policyHash);
  expect(payload.report.determinism).toBeDefined();

  const markdownResponse = await app.inject({
    method: "GET",
    url: `/v1/policy/provenance?policyHash=${policyHash}&format=md`
  });

  expect(markdownResponse.statusCode).toBe(200);
  expect(markdownResponse.headers["content-type"]).toContain("text/markdown");
  expect(markdownResponse.body).toContain("Policy Provenance Report");

  await app.close();
});

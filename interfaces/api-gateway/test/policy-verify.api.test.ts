import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import { InMemoryGuardrailCheckStore } from "../src/policy-promotion-guardrails/store";
import { InMemoryPolicyApprovalStore } from "../src/policy-approvals/store";
import type { PolicyReplayStore } from "../src/policy-replay/replay-store";
import type { PolicyOutcomeStore } from "../src/policy-outcomes/store";
import type { PolicyLineageStore } from "../src/policy-lineage/store";
import type { GuardrailCheckStore } from "../src/policy-promotion-guardrails/store";
import type { PolicyApprovalStore } from "../src/policy-approvals/store";

const stores = vi.hoisted(() => ({
  replayStore: null as PolicyReplayStore | null,
  outcomeStore: null as PolicyOutcomeStore | null,
  lineageStore: null as PolicyLineageStore | null,
  guardrailCheckStore: null as GuardrailCheckStore | null,
  approvalStore: null as PolicyApprovalStore | null
}));

vi.mock("../src/policy-replay/replay-store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-replay/replay-store")>(
    "../src/policy-replay/replay-store"
  );
  return {
    ...actual,
    createPolicyReplayStore: () => stores.replayStore as PolicyReplayStore
  };
});

vi.mock("../src/policy-outcomes/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-outcomes/store")>(
    "../src/policy-outcomes/store"
  );
  return {
    ...actual,
    createPolicyOutcomeStore: () => stores.outcomeStore as PolicyOutcomeStore
  };
});

vi.mock("../src/policy-lineage/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lineage/store")>(
    "../src/policy-lineage/store"
  );
  return {
    ...actual,
    createPolicyLineageStore: () => stores.lineageStore as PolicyLineageStore
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
  const actual = await vi.importActual<typeof import("../src/policy-approvals/store")>(
    "../src/policy-approvals/store"
  );
  return {
    ...actual,
    createPolicyApprovalStore: () => stores.approvalStore as PolicyApprovalStore
  };
});

async function buildApp() {
  const { registerRoutes } = await import("../src/routes");
  const app = Fastify();
  await registerRoutes(app);
  await app.ready();
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});

test("policy events and verify endpoints return deterministic responses", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-02-15T12:00:00Z"));

  const replayStore = new InMemoryPolicyReplayStore();
  const outcomeStore = new InMemoryPolicyOutcomeStore();
  const lineageStore = new InMemoryPolicyLineageStore();
  const guardrailCheckStore = new InMemoryGuardrailCheckStore();
  const approvalStore = new InMemoryPolicyApprovalStore();

  stores.replayStore = replayStore;
  stores.outcomeStore = outcomeStore;
  stores.lineageStore = lineageStore;
  stores.guardrailCheckStore = guardrailCheckStore;
  stores.approvalStore = approvalStore;

  const app = await buildApp();

  const statusResponse = await app.inject({ method: "GET", url: "/v1/policy/status" });
  const statusPayload = statusResponse.json();
  const policyHash = statusPayload.active.policyHash;

  await outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash,
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: new Date("2024-02-10T00:00:00Z")
  });

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
      candidateMatchedRules: ["rule-1", "rule-2"],
      candidateConstraintTypes: [],
      baselineRisk: { level: "low", signals: [] },
      reasons: [],
      categories: [],
      risk: { level: "medium", signals: [] },
      createdAt: new Date("2024-02-10T12:00:00Z")
    }
  ]);

  await approvalStore.recordApproval({
    policyHash,
    approvedBy: "reviewer",
    approvedAt: "2024-02-10T14:00:00Z",
    rationale: "Approved",
    acceptedRiskScore: 5,
    notes: "Ready",
    runId: run.id
  });

  await lineageStore.createLineage({
    policyHash,
    parentPolicyHash: null,
    promotedBy: "reviewer",
    promotedAt: "2024-02-10T15:00:00Z",
    rationale: "Promoted",
    acceptedRiskScore: 5,
    source: "manual",
    drift: { constraintsAdded: 1, constraintsRemoved: 0, severityDelta: 1, netRiskScoreChange: 0 }
  });

  const eventsResponse = await app.inject({
    method: "GET",
    url: `/v1/policy/events?policyHash=${policyHash}`
  });

  expect(eventsResponse.statusCode).toBe(200);
  const eventsPayload = eventsResponse.json();
  expect(eventsPayload.events.length).toBeGreaterThan(0);

  const verifyResponse = await app.inject({
    method: "GET",
    url: `/v1/policy/verify?policyHash=${policyHash}`
  });

  expect(verifyResponse.statusCode).toBe(200);
  const verifyPayload = verifyResponse.json();
  expect(verifyPayload.verified).toBe(true);
  expect(verifyPayload.mismatches).toHaveLength(0);
  expect(verifyPayload.eventCount).toBeGreaterThan(0);

  await app.close();
});

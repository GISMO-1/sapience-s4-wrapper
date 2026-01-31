import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import type { IntentStore } from "../src/intent/intent-store";
import { InMemoryIntentStore } from "../src/intent/intent-store.memory";
import type { PolicyStore, PolicyDecisionRecord } from "../src/policy/policy-store";
import type { PolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";

const stores = vi.hoisted(() => ({
  intentStore: null as IntentStore | null,
  policyStore: null as PolicyStore | null,
  outcomeStore: null as PolicyOutcomeStore | null
}));

vi.mock("../src/intent/intent-store", async () => {
  const actual = await vi.importActual<typeof import("../src/intent/intent-store")>(
    "../src/intent/intent-store"
  );
  return {
    ...actual,
    createIntentStore: () => stores.intentStore as IntentStore
  };
});

vi.mock("../src/policy/policy-store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy/policy-store")>(
    "../src/policy/policy-store"
  );
  return {
    ...actual,
    createPolicyStore: () => stores.policyStore as PolicyStore
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

async function buildApp() {
  const { registerRoutes } = await import("../src/routes");
  const app = Fastify();
  await registerRoutes(app);
  await app.ready();
  return app;
}

function buildPolicyRecord(traceId: string): PolicyDecisionRecord {
  return {
    id: "decision-1",
    traceId,
    policyHash: "policy-hash-1",
    decision: "WARN",
    matchedRuleIds: ["rule-1"],
    reasons: [],
    categories: [],
    risk: { level: "low", signals: [] },
    createdAt: new Date("2024-02-01T00:00:00Z")
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

test("posting outcome requires existing traceId", async () => {
  const intentStore = new InMemoryIntentStore();
  const policyRecord = buildPolicyRecord("trace-missing");
  stores.intentStore = intentStore;
  stores.policyStore = {
    savePolicyDecision: async () => policyRecord,
    getPolicyByTraceId: async () => policyRecord
  };
  stores.outcomeStore = new InMemoryPolicyOutcomeStore();

  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/outcomes",
    payload: {
      traceId: "trace-missing",
      outcomeType: "failure",
      severity: 2
    }
  });

  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({ message: "Intent not found", traceId: "trace-missing" });
  await app.close();
});

test("stores normalized outcome and fetches by traceId", async () => {
  const intentStore = new InMemoryIntentStore();
  const traceId = "trace-123";
  await intentStore.saveIntent(
    { intentType: "CREATE_PO", rawText: "create po", confidence: 0.9, entities: {} },
    traceId
  );
  const policyRecord = buildPolicyRecord(traceId);
  stores.intentStore = intentStore;
  stores.policyStore = {
    savePolicyDecision: async () => policyRecord,
    getPolicyByTraceId: async () => policyRecord
  };
  stores.outcomeStore = new InMemoryPolicyOutcomeStore();

  const app = await buildApp();
  const postResponse = await app.inject({
    method: "POST",
    url: "/v1/policy/outcomes",
    payload: {
      traceId,
      outcomeType: "override",
      humanOverride: true,
      notes: "Synthetic override"
    }
  });

  expect(postResponse.statusCode).toBe(200);
  const postPayload = postResponse.json();
  expect(postPayload.outcome).toMatchObject({
    traceId,
    intentType: "CREATE_PO",
    policyHash: policyRecord.policyHash,
    decision: policyRecord.decision,
    outcomeType: "override",
    severity: 1,
    humanOverride: true,
    notes: "Synthetic override"
  });
  expect(postPayload.outcome.observedAt).toBeDefined();

  const getResponse = await app.inject({ method: "GET", url: `/v1/policy/outcomes/${traceId}` });
  expect(getResponse.statusCode).toBe(200);
  const getPayload = getResponse.json();
  expect(getPayload.outcomes).toHaveLength(1);
  expect(getPayload.outcomes[0].traceId).toBe(traceId);

  await app.close();
});

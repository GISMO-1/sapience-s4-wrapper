import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyLifecycleStore } from "../src/policy-lifecycle/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";

let outcomeStore: InMemoryPolicyOutcomeStore;
let replayStore: InMemoryPolicyReplayStore;
let lifecycleStore: InMemoryPolicyLifecycleStore;
let lineageStore: InMemoryPolicyLineageStore;

vi.mock("../src/policy-outcomes/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-outcomes/store")>("../src/policy-outcomes/store");
  return {
    ...actual,
    createPolicyOutcomeStore: () => outcomeStore
  };
});

vi.mock("../src/policy-replay/replay-store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-replay/replay-store")>("../src/policy-replay/replay-store");
  return {
    ...actual,
    createPolicyReplayStore: () => replayStore
  };
});

vi.mock("../src/policy-lifecycle/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lifecycle/store")>("../src/policy-lifecycle/store");
  return {
    ...actual,
    createPolicyLifecycleStore: () => lifecycleStore
  };
});

vi.mock("../src/policy-lineage/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lineage/store")>("../src/policy-lineage/store");
  return {
    ...actual,
    createPolicyLineageStore: () => lineageStore
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
});

test("counterfactual endpoint resolves baseline policy by window start", async () => {
  outcomeStore = new InMemoryPolicyOutcomeStore();
  replayStore = new InMemoryPolicyReplayStore();
  lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-02-03T00:00:00Z"));
  lineageStore = new InMemoryPolicyLineageStore();

  await lineageStore.createLineage({
    policyHash: "policy-a",
    parentPolicyHash: null,
    promotedBy: "ops",
    promotedAt: "2024-01-01T00:00:00Z",
    rationale: "baseline",
    acceptedRiskScore: 0,
    source: "manual",
    drift: {
      constraintsAdded: 0,
      constraintsRemoved: 0,
      severityDelta: 0,
      netRiskScoreChange: 0
    }
  });

  await lineageStore.createLineage({
    policyHash: "policy-b",
    parentPolicyHash: "policy-a",
    promotedBy: "ops",
    promotedAt: "2024-02-01T00:00:00Z",
    rationale: "promotion",
    acceptedRiskScore: 0,
    source: "manual",
    drift: {
      constraintsAdded: 0,
      constraintsRemoved: 0,
      severityDelta: 0,
      netRiskScoreChange: 0
    }
  });

  lifecycleStore.setActivePolicy({
    hash: "policy-b",
    version: "v1",
    path: "policies.v1.yaml",
    loadedAt: "2024-02-01T00:00:00Z"
  });

  await outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash: "policy-a",
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: new Date("2024-01-15T10:00:00Z")
  });

  const app = await buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/counterfactual",
    payload: {
      policyHash: "policy-candidate",
      since: "2024-01-15T00:00:00Z",
      until: "2024-01-16T00:00:00Z"
    }
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.baselinePolicyHash).toBe("policy-a");
  expect(payload.window.since).toBe("2024-01-15T00:00:00.000Z");
  expect(payload.window.until).toBe("2024-01-16T00:00:00.000Z");

  await app.close();
});

test("blast radius endpoint uses window-based computation", async () => {
  outcomeStore = new InMemoryPolicyOutcomeStore();
  replayStore = new InMemoryPolicyReplayStore();
  lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-02-03T00:00:00Z"));
  lineageStore = new InMemoryPolicyLineageStore();

  await lineageStore.createLineage({
    policyHash: "policy-a",
    parentPolicyHash: null,
    promotedBy: "ops",
    promotedAt: "2024-01-01T00:00:00Z",
    rationale: "baseline",
    acceptedRiskScore: 0,
    source: "manual",
    drift: {
      constraintsAdded: 0,
      constraintsRemoved: 0,
      severityDelta: 0,
      netRiskScoreChange: 0
    }
  });

  lifecycleStore.setActivePolicy({
    hash: "policy-a",
    version: "v1",
    path: "policies.v1.yaml",
    loadedAt: "2024-01-01T00:00:00Z"
  });

  await outcomeStore.recordOutcome({
    traceId: "trace-2",
    intentType: "REVIEW_INVOICE",
    policyHash: "policy-a",
    decision: "WARN",
    outcomeType: "override",
    severity: 2,
    humanOverride: true,
    observedAt: new Date("2024-01-10T10:00:00Z")
  });

  const app = await buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/v1/policy/blast-radius?policyHash=policy-candidate&since=2024-01-10T00:00:00Z&until=2024-01-11T00:00:00Z"
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.window.since).toBe("2024-01-10T00:00:00.000Z");
  expect(payload.window.until).toBe("2024-01-11T00:00:00.000Z");
  expect(payload.baselinePolicyHash).toBe("policy-a");

  await app.close();
});

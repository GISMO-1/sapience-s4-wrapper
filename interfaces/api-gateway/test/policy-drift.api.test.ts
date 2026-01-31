import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import type { PolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import type { PolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import type { PolicyLineageStore } from "../src/policy-lineage/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";

const stores = vi.hoisted(() => ({
  outcomeStore: null as PolicyOutcomeStore | null,
  replayStore: null as PolicyReplayStore | null,
  lineageStore: null as PolicyLineageStore | null
}));

vi.mock("../src/policy-outcomes/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-outcomes/store")>(
    "../src/policy-outcomes/store"
  );
  return {
    ...actual,
    createPolicyOutcomeStore: () => stores.outcomeStore as PolicyOutcomeStore
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

vi.mock("../src/policy-lineage/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lineage/store")>(
    "../src/policy-lineage/store"
  );
  return {
    ...actual,
    createPolicyLineageStore: () => stores.lineageStore as PolicyLineageStore
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

test("returns drift report with defaults and respects query overrides", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-02-15T12:00:00Z"));

  const outcomeStore = new InMemoryPolicyOutcomeStore();
  const replayStore = new InMemoryPolicyReplayStore();
  const lineageStore = new InMemoryPolicyLineageStore();
  stores.outcomeStore = outcomeStore;
  stores.replayStore = replayStore;
  stores.lineageStore = lineageStore;

  await outcomeStore.recordOutcome({
    traceId: "trace-recent",
    intentType: "CREATE_PO",
    policyHash: "policy-1",
    decision: "ALLOW",
    outcomeType: "failure",
    severity: 2,
    humanOverride: false,
    observedAt: new Date("2024-02-10T00:00:00Z")
  });
  await outcomeStore.recordOutcome({
    traceId: "trace-baseline",
    intentType: "CREATE_PO",
    policyHash: "policy-1",
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: new Date("2024-01-20T00:00:00Z")
  });

  vi.setSystemTime(new Date("2024-02-10T12:00:00Z"));
  const run = await replayStore.createRun({
    baselinePolicyHash: "base-1",
    candidatePolicyHash: "policy-1",
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
      candidatePolicyHash: "policy-1",
      baselineMatchedRules: ["rule-1"],
      candidateMatchedRules: ["rule-1", "rule-2"],
      candidateConstraintTypes: [],
      baselineRisk: { level: "low", signals: [] },
      reasons: [],
      categories: [],
      risk: { level: "low", signals: [] },
      createdAt: new Date("2024-02-10T12:00:00Z")
    }
  ]);
  vi.setSystemTime(new Date("2024-02-15T12:00:00Z"));

  const app = await buildApp();
  const response = await app.inject({
    method: "GET",
    url: "/v1/policy/drift?policyHash=policy-1"
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.report.policyHash).toBe("policy-1");
  expect(payload.report.recent.window.since).toBe("2024-02-08T12:00:00.000Z");
  expect(payload.report.recent.window.until).toBe("2024-02-15T12:00:00.000Z");
  expect(payload.report.baseline.window.until).toBe("2024-02-08T12:00:00.000Z");
  expect(payload.report.baseline.window.since).toBe("2024-01-09T12:00:00.000Z");
  expect(payload.report.recent.metrics.replayAdded).toBe(1);

  const overrideResponse = await app.inject({
    method: "GET",
    url: "/v1/policy/drift?policyHash=policy-1&since=2024-02-01T00:00:00Z&until=2024-02-05T00:00:00Z&baselineSince=2024-01-01T00:00:00Z&baselineUntil=2024-01-15T00:00:00Z"
  });

  const overridePayload = overrideResponse.json();
  expect(overridePayload.report.recent.window.since).toBe("2024-02-01T00:00:00.000Z");
  expect(overridePayload.report.recent.window.until).toBe("2024-02-05T00:00:00.000Z");
  expect(overridePayload.report.baseline.window.since).toBe("2024-01-01T00:00:00.000Z");
  expect(overridePayload.report.baseline.window.until).toBe("2024-01-15T00:00:00.000Z");

  await app.close();
});

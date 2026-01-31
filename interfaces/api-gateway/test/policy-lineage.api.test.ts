import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import type { PolicyLineageStore } from "../src/policy-lineage/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import type { PolicyLifecycleStore } from "../src/policy-lifecycle/store";
import { InMemoryPolicyLifecycleStore } from "../src/policy-lifecycle/store";
import type { PolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";

const stores = vi.hoisted(() => ({
  lineageStore: null as PolicyLineageStore | null,
  lifecycleStore: null as PolicyLifecycleStore | null,
  replayStore: null as PolicyReplayStore | null
}));

vi.mock("../src/policy-lineage/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lineage/store")>(
    "../src/policy-lineage/store"
  );
  return {
    ...actual,
    createPolicyLineageStore: () => stores.lineageStore as PolicyLineageStore
  };
});

vi.mock("../src/policy-lifecycle/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lifecycle/store")>(
    "../src/policy-lifecycle/store"
  );
  return {
    ...actual,
    createPolicyLifecycleStore: () => stores.lifecycleStore as PolicyLifecycleStore
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

test("policy lineage endpoints return chain", async () => {
  stores.lineageStore = new InMemoryPolicyLineageStore();
  stores.lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-02-01T00:00:00Z"));
  stores.replayStore = new InMemoryPolicyReplayStore();

  const app = await buildApp();

  stores.lifecycleStore.setActivePolicy({
    hash: "policy-1",
    version: "v1",
    path: "/tmp/policies.v1.yaml",
    loadedAt: "2024-02-01T00:00:00Z"
  });

  await stores.lineageStore.createLineage({
    policyHash: "policy-1",
    parentPolicyHash: "policy-0",
    promotedBy: "Reviewer",
    promotedAt: "2024-02-01T10:00:00Z",
    rationale: "Regression results match baseline.",
    acceptedRiskScore: 12,
    source: "replay",
    drift: {
      constraintsAdded: 2,
      constraintsRemoved: 1,
      severityDelta: 1,
      netRiskScoreChange: 1
    }
  });

  await stores.lineageStore.createLineage({
    policyHash: "policy-0",
    parentPolicyHash: null,
    promotedBy: "Reviewer",
    promotedAt: "2024-01-01T10:00:00Z",
    rationale: "Initial baseline.",
    acceptedRiskScore: 10,
    source: "manual",
    drift: {
      constraintsAdded: 0,
      constraintsRemoved: 0,
      severityDelta: 0,
      netRiskScoreChange: 0
    }
  });
  const response = await app.inject({ method: "GET", url: "/v1/policy/lineage/current" });
  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.policyHash).toBe("policy-1");
  expect(payload.lineage).toHaveLength(2);

  const byHash = await app.inject({ method: "GET", url: "/v1/policy/lineage/policy-0" });
  expect(byHash.statusCode).toBe(200);
  expect(byHash.json().lineage[0].policyHash).toBe("policy-0");

  await app.close();
});

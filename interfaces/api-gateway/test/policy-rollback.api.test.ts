import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import type { PolicyLineageStore } from "../src/policy-lineage/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import type { PolicyLifecycleStore } from "../src/policy-lifecycle/store";
import { InMemoryPolicyLifecycleStore } from "../src/policy-lifecycle/store";
import type { PolicyRollbackStore } from "../src/policy-rollback/store";
import { InMemoryPolicyRollbackStore } from "../src/policy-rollback/store";

const stores = vi.hoisted(() => ({
  lineageStore: null as PolicyLineageStore | null,
  lifecycleStore: null as PolicyLifecycleStore | null,
  rollbackStore: null as PolicyRollbackStore | null
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

vi.mock("../src/policy-rollback/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-rollback/store")>(
    "../src/policy-rollback/store"
  );
  return {
    ...actual,
    createPolicyRollbackStore: () => stores.rollbackStore as PolicyRollbackStore
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

test("rollback endpoint supports dry runs and executions", async () => {
  stores.lineageStore = new InMemoryPolicyLineageStore();
  stores.lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-02-01T00:00:00Z"));
  stores.rollbackStore = new InMemoryPolicyRollbackStore();

  const app = await buildApp();

  stores.lifecycleStore.setActivePolicy({
    hash: "policy-2",
    version: "v1",
    path: "/tmp/policies.v1.yaml",
    loadedAt: "2024-02-01T00:00:00Z"
  });

  await stores.lineageStore.createLineage({
    policyHash: "policy-1",
    parentPolicyHash: null,
    promotedBy: "Reviewer",
    promotedAt: "2024-01-10T10:00:00Z",
    rationale: "Baseline promotion",
    acceptedRiskScore: 2,
    source: "manual",
    drift: { constraintsAdded: 0, constraintsRemoved: 0, severityDelta: 0, netRiskScoreChange: 0 }
  });

  const dryRun = await app.inject({
    method: "POST",
    url: "/v1/policy/rollback",
    payload: {
      targetPolicyHash: "policy-1",
      actor: "analyst",
      rationale: "Dry run",
      dryRun: true
    }
  });

  expect(dryRun.statusCode).toBe(200);
  const dryPayload = dryRun.json();
  expect(dryPayload.decision.ok).toBe(true);
  expect(dryPayload.event).toBeNull();
  expect(stores.lifecycleStore.getActivePolicy()?.policyHash).toBe("policy-2");

  const execute = await app.inject({
    method: "POST",
    url: "/v1/policy/rollback",
    payload: {
      targetPolicyHash: "policy-1",
      actor: "analyst",
      rationale: "Rollback after regression"
    }
  });

  expect(execute.statusCode).toBe(200);
  const executePayload = execute.json();
  expect(executePayload.decision.ok).toBe(true);
  expect(executePayload.event.eventHash).toBeTruthy();
  expect(stores.lifecycleStore.getActivePolicy()?.policyHash).toBe("policy-1");
  const rollbacks = await stores.rollbackStore.listRollbacks({ policyHash: "policy-1" });
  expect(rollbacks).toHaveLength(1);

  await app.close();
});

test("rollback endpoint rejects missing lineage targets", async () => {
  stores.lineageStore = new InMemoryPolicyLineageStore();
  stores.lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-02-01T00:00:00Z"));
  stores.rollbackStore = new InMemoryPolicyRollbackStore();

  const app = await buildApp();

  stores.lifecycleStore.setActivePolicy({
    hash: "policy-2",
    version: "v1",
    path: "/tmp/policies.v1.yaml",
    loadedAt: "2024-02-01T00:00:00Z"
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/rollback",
    payload: {
      targetPolicyHash: "missing-policy",
      actor: "analyst",
      rationale: "Invalid rollback"
    }
  });

  expect(response.statusCode).toBe(404);
  const payload = response.json();
  expect(payload.decision.ok).toBe(false);

  await app.close();
});

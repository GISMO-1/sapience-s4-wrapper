import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import type { PolicyLifecycleStore } from "../src/policy-lifecycle/store";
import { InMemoryPolicyLifecycleStore } from "../src/policy-lifecycle/store";
import type { PolicyLineageStore } from "../src/policy-lineage/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import type { ReplayResultRecord } from "../src/policy-replay/types";

let replayStore: PolicyReplayStore;
let lifecycleStore: PolicyLifecycleStore;
let lineageStore: PolicyLineageStore;

vi.mock("../src/policy-replay/replay-store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-replay/replay-store")>(
    "../src/policy-replay/replay-store"
  );
  return {
    ...actual,
    createPolicyReplayStore: () => replayStore
  };
});

vi.mock("../src/policy-lifecycle/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lifecycle/store")>(
    "../src/policy-lifecycle/store"
  );
  return {
    ...actual,
    createPolicyLifecycleStore: () => lifecycleStore
  };
});

vi.mock("../src/policy-lineage/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-lineage/store")>(
    "../src/policy-lineage/store"
  );
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

function writeTempPolicy(yaml: string): string {
  const tempDir = mkdtempSync(path.join(tmpdir(), "policy-promo-"));
  const policyPath = path.join(tempDir, "policies.v1.yaml");
  writeFileSync(policyPath, yaml);
  return policyPath;
}

function buildResult(id: string, overrides?: Partial<ReplayResultRecord>): ReplayResultRecord {
  return {
    id,
    runId: overrides?.runId ?? "run-1",
    traceId: overrides?.traceId ?? `trace-${id}`,
    intentType: overrides?.intentType ?? "CREATE_PO",
    baselineDecision: overrides?.baselineDecision ?? "ALLOW",
    candidateDecision: overrides?.candidateDecision ?? "DENY",
    changed: overrides?.changed ?? true,
    baselinePolicyHash: overrides?.baselinePolicyHash ?? "base-hash",
    candidatePolicyHash: overrides?.candidatePolicyHash ?? "cand-hash",
    baselineMatchedRules: overrides?.baselineMatchedRules ?? [],
    candidateMatchedRules: overrides?.candidateMatchedRules ?? [],
    candidateConstraintTypes: overrides?.candidateConstraintTypes ?? [],
    baselineRisk: overrides?.baselineRisk ?? { level: "low", signals: [] },
    reasons: overrides?.reasons ?? [],
    categories: overrides?.categories ?? [],
    risk: overrides?.risk ?? { level: "low", signals: [] },
    createdAt: overrides?.createdAt ?? new Date("2024-02-01T00:00:00Z")
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.POLICY_PATH;
});

test("policy promotion succeeds when guardrails are within limits", async () => {
  process.env.POLICY_PATH = writeTempPolicy(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.5\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  replayStore = new InMemoryPolicyReplayStore();
  lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-02-01T00:00:00Z"));
  lineageStore = new InMemoryPolicyLineageStore();

  const run = await replayStore.createRun({
    requestedBy: "tester",
    baselinePolicyHash: "base-hash",
    candidatePolicyHash: "cand-hash",
    candidatePolicySource: "current",
    candidatePolicyRef: null,
    intentTypeFilter: null,
    since: null,
    until: null,
    limit: 10
  });

  await replayStore.saveResults(run.id, [buildResult("res-1", { runId: run.id })]);

  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/promote",
    payload: {
      runId: run.id,
      approvedBy: "Reviewer",
      rationale: "Regression results match baseline expectations.",
      acceptedRiskScore: 12,
      reason: "Regression clean",
      notes: "Low blast radius."
    }
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.promoted.policyHash).toBe("cand-hash");
  expect(payload.promoted.state).toBe("active");
  expect(payload.promoted.approval.approvedBy).toBe("Reviewer");

  await app.close();
});

test("policy promotion is blocked when impact thresholds are exceeded", async () => {
  process.env.POLICY_PATH = writeTempPolicy(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.5\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  replayStore = new InMemoryPolicyReplayStore();
  lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-02-01T00:00:00Z"));
  lineageStore = new InMemoryPolicyLineageStore();

  const run = await replayStore.createRun({
    requestedBy: "tester",
    baselinePolicyHash: "base-hash",
    candidatePolicyHash: "cand-hash",
    candidatePolicySource: "current",
    candidatePolicyRef: null,
    intentTypeFilter: null,
    since: null,
    until: null,
    limit: 50
  });

  const results = Array.from({ length: 30 }, (_, index) =>
    buildResult(`res-${index}`, { runId: run.id })
  );
  await replayStore.saveResults(run.id, results);

  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/promote",
    payload: {
      runId: run.id,
      approvedBy: "Reviewer",
      rationale: "Regression results match baseline expectations.",
      acceptedRiskScore: 12,
      reason: "Regression clean"
    }
  });

  expect(response.statusCode).toBe(409);
  const payload = response.json();
  expect(payload.message).toBe("Promotion blocked by impact guardrails.");

  await app.close();
});

test("policy promotion rejects payloads without rationale or accepted risk", async () => {
  replayStore = new InMemoryPolicyReplayStore();
  lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-02-01T00:00:00Z"));
  lineageStore = new InMemoryPolicyLineageStore();

  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/promote",
    payload: {
      runId: "run-1",
      approvedBy: "Reviewer",
      reason: "Regression clean"
    }
  });

  expect(response.statusCode).toBe(400);
  const payload = response.json();
  expect(payload.message).toBe("Invalid promotion payload");

  await app.close();
});

import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import type { PolicyReplayStore } from "../src/policy-replay/replay-store";
import type { ReplayResultRecord, ReplayRunRecord } from "../src/policy-replay/types";

let replayStore: PolicyReplayStore;

vi.mock("../src/policy-replay/replay-store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-replay/replay-store")>(
    "../src/policy-replay/replay-store"
  );
  return {
    ...actual,
    createPolicyReplayStore: () => replayStore
  };
});

async function buildApp() {
  const { registerRoutes } = await import("../src/routes");
  const app = Fastify();
  await registerRoutes(app);
  await app.ready();
  return app;
}

function buildRun(): ReplayRunRecord {
  return {
    id: "run-1",
    requestedBy: "tester",
    baselinePolicyHash: "base-hash",
    candidatePolicyHash: "cand-hash",
    candidatePolicySource: "current",
    candidatePolicyRef: null,
    intentTypeFilter: ["CREATE_PO", "CHECK_INVENTORY"],
    since: new Date("2024-01-01T00:00:00Z"),
    until: new Date("2024-01-02T00:00:00Z"),
    limit: 100,
    createdAt: new Date("2024-02-01T10:00:00Z")
  };
}

function buildResult(partial: Partial<ReplayResultRecord>): ReplayResultRecord {
  return {
    id: partial.id ?? "res-1",
    runId: partial.runId ?? "run-1",
    traceId: partial.traceId ?? "trace-1",
    intentType: partial.intentType ?? "CREATE_PO",
    baselineDecision: partial.baselineDecision ?? "ALLOW",
    candidateDecision: partial.candidateDecision ?? "ALLOW",
    changed: partial.changed ?? false,
    baselinePolicyHash: partial.baselinePolicyHash ?? "base-hash",
    candidatePolicyHash: partial.candidatePolicyHash ?? "cand-hash",
    baselineMatchedRules: partial.baselineMatchedRules ?? [],
    candidateMatchedRules: partial.candidateMatchedRules ?? [],
    reasons: partial.reasons ?? [],
    categories: partial.categories ?? [],
    risk: partial.risk ?? { level: "low", signals: [] },
    createdAt: partial.createdAt ?? new Date("2024-01-01T00:00:00Z")
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

test("replay report aggregates totals, deltas, and stable ordering", async () => {
  const run = buildRun();
  const results: ReplayResultRecord[] = [
    buildResult({
      id: "res-1",
      traceId: "trace-1",
      intentType: "CREATE_PO",
      baselineDecision: "ALLOW",
      candidateDecision: "DENY",
      changed: true,
      baselineMatchedRules: ["rule-a"],
      candidateMatchedRules: ["rule-a", "rule-b"]
    }),
    buildResult({
      id: "res-2",
      traceId: "trace-2",
      intentType: "CREATE_PO",
      baselineDecision: "WARN",
      candidateDecision: "ALLOW",
      changed: true,
      baselineMatchedRules: ["rule-b"],
      candidateMatchedRules: ["rule-b"]
    }),
    buildResult({
      id: "res-3",
      traceId: "trace-3",
      intentType: "CHECK_INVENTORY",
      baselineDecision: "DENY",
      candidateDecision: "DENY",
      changed: true,
      baselineMatchedRules: ["rule-c"],
      candidateMatchedRules: ["rule-d"]
    }),
    buildResult({
      id: "res-4",
      traceId: "trace-4",
      intentType: "CHECK_INVENTORY",
      baselineDecision: "ALLOW",
      candidateDecision: "ALLOW",
      changed: false,
      baselineMatchedRules: [],
      candidateMatchedRules: []
    })
  ];

  replayStore = {
    listBaselineIntents: async () => [],
    createRun: async () => run,
    saveResults: async () => undefined,
    getRun: async () => run,
    getResults: async () => results,
    getRunTotals: async () => ({ count: 4, changed: 3, allow: 2, warn: 0, deny: 2 })
  };

  const app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/v1/policy/replay/run-1/report" });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.traceId).toBeDefined();
  expect(payload.run.runId).toBe("run-1");
  expect(payload.totals).toEqual({
    count: 4,
    changed: 3,
    unchanged: 1,
    baseline: { allow: 2, warn: 1, deny: 1 },
    candidate: { allow: 2, warn: 0, deny: 2 }
  });
  expect(payload.deltas).toEqual({ allowDelta: 0, warnDelta: -1, denyDelta: 1 });

  expect(payload.byIntentType.map((entry: any) => entry.intentType)).toEqual([
    "CHECK_INVENTORY",
    "CREATE_PO"
  ]);
  expect(payload.byIntentType[1]).toMatchObject({
    intentType: "CREATE_PO",
    count: 2,
    changed: 2,
    baseline: { allow: 1, warn: 1, deny: 0 },
    candidate: { allow: 1, warn: 0, deny: 1 }
  });

  expect(payload.topRuleChanges.map((entry: any) => entry.ruleId)).toEqual(["rule-b", "rule-a", "rule-c", "rule-d"]);
  expect(payload.topRuleChanges[0]).toMatchObject({
    ruleId: "rule-b",
    direction: "mixed",
    changedCount: 2,
    examples: [
      { traceId: "trace-1", baselineDecision: "ALLOW", candidateDecision: "DENY" },
      { traceId: "trace-2", baselineDecision: "WARN", candidateDecision: "ALLOW" }
    ]
  });
  expect(payload.topRuleChanges[1].direction).toBe("more_strict");

  expect(payload.topChangedExamples.map((entry: any) => entry.traceId)).toEqual(["trace-1", "trace-2", "trace-3"]);

  await app.close();
});

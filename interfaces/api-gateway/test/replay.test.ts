import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import type { ReplayBaselineIntent } from "../src/policy-replay/types";
import type { Intent } from "../src/intent/intent-model";

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

function writeTempPolicy(yaml: string): string {
  const tempDir = mkdtempSync(path.join(tmpdir(), "policy-replay-"));
  const policyPath = path.join(tempDir, "policies.v1.yaml");
  writeFileSync(policyPath, yaml);
  return policyPath;
}

function baselineIntent(overrides?: Partial<ReplayBaselineIntent>): ReplayBaselineIntent {
  const intent: Intent = {
    intentType: "CREATE_PO",
    entities: { sku: "SKU-1" },
    confidence: 0.9,
    rawText: "create PO"
  };
  return {
    traceId: "trace-1",
    intentType: intent.intentType,
    intent,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    baselineDecision: "ALLOW",
    baselineMatchedRules: [],
    baselinePolicyHash: "baseline-hash",
    ...overrides
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.POLICY_PATH;
  delete process.env.POLICY_INLINE_ENABLED;
});

test("replay with current policy returns summary", async () => {
  process.env.POLICY_PATH = writeTempPolicy(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.5\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  replayStore = new InMemoryPolicyReplayStore({
    baselineIntents: [baselineIntent()]
  });
  const app = await buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/replay",
    payload: { candidatePolicy: { source: "current" } }
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.run.runId).toBeDefined();
  expect(payload.run.candidate.source).toBe("current");
  expect(payload.run.totals.count).toBe(1);

  await app.close();
});

test("replay loads policy from path under policies", async () => {
  process.env.POLICY_PATH = writeTempPolicy(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.5\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  replayStore = new InMemoryPolicyReplayStore({
    baselineIntents: [baselineIntent()]
  });
  const app = await buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/replay",
    payload: { candidatePolicy: { source: "path", ref: "policies.v1.yaml" } }
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.run.candidate.source).toBe("path");

  await app.close();
});

test("inline policy is rejected when disabled", async () => {
  process.env.POLICY_PATH = writeTempPolicy(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.5\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  replayStore = new InMemoryPolicyReplayStore({
    baselineIntents: [baselineIntent()]
  });
  const app = await buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/replay",
    payload: { candidatePolicy: { source: "inline", yaml: "version: \"v1\"\n" } }
  });

  expect(response.statusCode).toBe(403);

  await app.close();
});

test("replay ordering is deterministic", async () => {
  process.env.POLICY_PATH = writeTempPolicy(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.2\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  const intents = [
    baselineIntent({
      traceId: "trace-b",
      createdAt: new Date("2024-01-02T00:00:00Z"),
      intent: { intentType: "CREATE_PO", entities: { sku: "SKU-B" }, confidence: 0.9, rawText: "b" }
    }),
    baselineIntent({
      traceId: "trace-a",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      intent: { intentType: "CREATE_PO", entities: { sku: "SKU-A" }, confidence: 0.9, rawText: "a" }
    }),
    baselineIntent({
      traceId: "trace-c",
      createdAt: new Date("2024-01-02T00:00:00Z"),
      intent: { intentType: "CREATE_PO", entities: { sku: "SKU-C" }, confidence: 0.9, rawText: "c" }
    })
  ];
  replayStore = new InMemoryPolicyReplayStore({ baselineIntents: intents });
  const app = await buildApp();

  const firstRun = await app.inject({
    method: "POST",
    url: "/v1/policy/replay",
    payload: { candidatePolicy: { source: "current" } }
  });
  const secondRun = await app.inject({
    method: "POST",
    url: "/v1/policy/replay",
    payload: { candidatePolicy: { source: "current" } }
  });

  const firstResults = await app.inject({
    method: "GET",
    url: `/v1/policy/replay/${firstRun.json().run.runId}/results`
  });
  const secondResults = await app.inject({
    method: "GET",
    url: `/v1/policy/replay/${secondRun.json().run.runId}/results`
  });

  const expectedOrder = ["trace-a", "trace-b", "trace-c"];
  expect(firstResults.json().results.map((result: any) => result.traceId)).toEqual(expectedOrder);
  expect(secondResults.json().results.map((result: any) => result.traceId)).toEqual(expectedOrder);

  await app.close();
});

test("diff detection flags changed decisions", async () => {
  process.env.POLICY_PATH = writeTempPolicy(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.4\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  process.env.POLICY_INLINE_ENABLED = "true";
  replayStore = new InMemoryPolicyReplayStore({
    baselineIntents: [
      baselineIntent({
        intent: { intentType: "CREATE_PO", entities: { sku: "SKU-LOW" }, confidence: 0.6, rawText: "low" },
        baselineDecision: "ALLOW",
        baselineMatchedRules: []
      })
    ]
  });
  const app = await buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/replay",
    payload: {
      candidatePolicy: {
        source: "inline",
        yaml:
          "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.8\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
      }
    }
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.run.totals.changed).toBe(1);
  expect(payload.run.totals.deny).toBe(1);

  await app.close();
});

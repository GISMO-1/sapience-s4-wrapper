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
  const tempDir = mkdtempSync(path.join(tmpdir(), "policy-impact-"));
  const policyPath = path.join(tempDir, "policies.v1.yaml");
  writeFileSync(policyPath, yaml);
  return policyPath;
}

function baselineIntent(overrides?: Partial<ReplayBaselineIntent>): ReplayBaselineIntent {
  const intent: Intent = {
    intentType: "CREATE_PO",
    entities: { amount: 1200, vendor: "ACME" },
    confidence: 0.8,
    rawText: "create PO"
  };
  return {
    traceId: "trace-1",
    intentType: intent.intentType,
    intent,
    createdAt: new Date("2024-02-01T00:00:00Z"),
    baselineDecision: "ALLOW",
    baselineMatchedRules: [],
    baselinePolicyHash: "baseline-hash",
    baselineRisk: { level: "low", signals: [] },
    ...overrides
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.POLICY_PATH;
  delete process.env.POLICY_INLINE_ENABLED;
});

test("policy impact endpoint compares candidate and current policies", async () => {
  process.env.POLICY_INLINE_ENABLED = "true";
  process.env.POLICY_PATH = writeTempPolicy(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.2\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  replayStore = new InMemoryPolicyReplayStore({
    baselineIntents: [baselineIntent()]
  });
  const app = await buildApp();

  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/impact",
    payload: {
      candidatePolicy:
        "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.95\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n",
      since: "2024-02-01T00:00:00Z",
      until: "2024-02-02T00:00:00Z",
      limit: 10
    }
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.policyHashCurrent).toBeDefined();
  expect(payload.policyHashCandidate).toBeDefined();
  expect(payload.totals.newlyBlocked).toBe(1);
  expect(payload.blastRadiusScore).toBe(7);
  expect(payload.rows).toHaveLength(1);

  await app.close();
});

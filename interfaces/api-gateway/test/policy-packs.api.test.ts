import Fastify from "fastify";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import type { PolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import type { PolicyLineageStore } from "../src/policy-lineage/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import type { ReplayBaselineIntent } from "../src/policy-replay/types";
import type { Intent } from "../src/intent/intent-model";

let replayStore: PolicyReplayStore;
let outcomeStore: PolicyOutcomeStore;
let lineageStore: PolicyLineageStore;
const createdPacks: string[] = [];

vi.mock("../src/policy-replay/replay-store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-replay/replay-store")>(
    "../src/policy-replay/replay-store"
  );
  return {
    ...actual,
    createPolicyReplayStore: () => replayStore
  };
});

vi.mock("../src/policy-outcomes/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-outcomes/store")>(
    "../src/policy-outcomes/store"
  );
  return {
    ...actual,
    createPolicyOutcomeStore: () => outcomeStore
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

const packsRoot = path.resolve(path.dirname(resolvePolicyPath()), "packs");

function resolvePolicyPath(): string {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", ".."),
    path.resolve(process.cwd(), "..", "..", "..")
  ];
  for (const root of roots) {
    const candidate = path.resolve(root, "policies", "policies.v1.yaml");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve(process.cwd(), "policies", "policies.v1.yaml");
}

function baselineIntent(overrides?: Partial<ReplayBaselineIntent>): ReplayBaselineIntent {
  const intent: Intent = {
    intentType: "CREATE_PO",
    entities: { amount: 1200, vendor: "ACME" },
    confidence: 0.8,
    rawText: "create PO"
  };
  return {
    traceId: "trace-pack-1",
    intentType: intent.intentType,
    intent,
    createdAt: new Date(),
    baselineDecision: "ALLOW",
    baselineMatchedRules: [],
    baselinePolicyHash: "baseline-hash",
    baselineRisk: { level: "low", signals: [] },
    ...overrides
  };
}

function createPack(name: string) {
  const packDir = path.join(packsRoot, name);
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    path.join(packDir, "pack.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        description: "Sample pack",
        createdAt: "2024-04-01T00:00:00Z",
        author: "Sapience"
      },
      null,
      2
    )
  );
  writeFileSync(
    path.join(packDir, "policy.yaml"),
    "version: \"v1\"\nmetadata:\n  name: \"Sample\"\ndefaults:\n  confidenceThreshold: 0.2\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  writeFileSync(path.join(packDir, "notes.md"), "Pack notes.");
  createdPacks.push(packDir);
  return packDir;
}

beforeEach(() => {
  vi.resetModules();
  process.env.USE_INMEMORY_STORE = "true";
  process.env.POLICY_PATH = resolvePolicyPath();
  replayStore = new InMemoryPolicyReplayStore({ baselineIntents: [baselineIntent()] });
  outcomeStore = new InMemoryPolicyOutcomeStore();
  lineageStore = new InMemoryPolicyLineageStore();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.USE_INMEMORY_STORE;
  delete process.env.POLICY_PATH;
  while (createdPacks.length) {
    const packDir = createdPacks.pop();
    if (!packDir) {
      break;
    }
    try {
      rmSync(packDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

test("policy pack endpoints list, fetch, and install", async () => {
  createPack("sample-pack");
  await outcomeStore.recordOutcome({
    traceId: "trace-pack-1",
    intentType: "CREATE_PO",
    policyHash: "baseline-hash",
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false
  });
  const app = await buildApp();

  const listResponse = await app.inject({ method: "GET", url: "/v1/policy/packs" });
  expect(listResponse.statusCode).toBe(200);
  const listPayload = listResponse.json();
  expect(listPayload.packs).toHaveLength(1);
  expect(listPayload.packs[0].name).toBe("sample-pack");

  const detailResponse = await app.inject({ method: "GET", url: "/v1/policy/packs/sample-pack" });
  expect(detailResponse.statusCode).toBe(200);
  const detailPayload = detailResponse.json();
  expect(detailPayload.pack.name).toBe("sample-pack");
  expect(detailPayload.pack.policy).toBeDefined();

  const installResponse = await app.inject({ method: "POST", url: "/v1/policy/packs/sample-pack/install" });
  expect(installResponse.statusCode).toBe(200);
  const installPayload = installResponse.json();
  expect(installPayload.bundle.pack.name).toBe("sample-pack");
  expect(installPayload.bundle.reports.impact.policyHashCandidate).toBeDefined();
  expect(installPayload.bundle.reports.drift.policyHash).toBeDefined();
  expect(installPayload.bundle.reports.guardrail.allowed).toBeDefined();

  await app.close();
});

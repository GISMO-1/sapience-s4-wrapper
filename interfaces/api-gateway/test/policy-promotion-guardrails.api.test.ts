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
import type { PolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import type { PolicyPromotionStore } from "../src/policy-promotions/store";
import { InMemoryPolicyPromotionStore } from "../src/policy-promotions/store";
import type { ReplayBaselineIntent, ReplayResultRecord } from "../src/policy-replay/types";
import { loadPolicyFromSource } from "../src/policy-code/loader";


let replayStore: PolicyReplayStore;
let lifecycleStore: PolicyLifecycleStore;
let lineageStore: PolicyLineageStore;
let outcomeStore: PolicyOutcomeStore;
let promotionStore: PolicyPromotionStore;

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

vi.mock("../src/policy-outcomes/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-outcomes/store")>(
    "../src/policy-outcomes/store"
  );
  return {
    ...actual,
    createPolicyOutcomeStore: () => outcomeStore
  };
});

vi.mock("../src/policy-promotions/store", async () => {
  const actual = await vi.importActual<typeof import("../src/policy-promotions/store")>(
    "../src/policy-promotions/store"
  );
  return {
    ...actual,
    createPolicyPromotionStore: () => promotionStore
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
  const tempDir = mkdtempSync(path.join(tmpdir(), "policy-guardrail-"));
  const policyPath = path.join(tempDir, "policies.v1.yaml");
  writeFileSync(policyPath, yaml);
  return policyPath;
}

function buildBaselineIntent(policyHash: string, createdAt: Date): ReplayBaselineIntent {
  return {
    traceId: "trace-1",
    intentType: "CREATE_PO",
    intent: {
      intentType: "CREATE_PO",
      entities: { quantity: 5, vendor: "VENDOR-1" },
      confidence: 0.6,
      rawText: "create purchase order"
    },
    createdAt,
    baselineDecision: "ALLOW",
    baselineMatchedRules: [],
    baselinePolicyHash: policyHash,
    baselineRisk: { level: "low", signals: [] }
  };
}

function buildReplayResult(runId: string, policyHash: string, createdAt: Date): ReplayResultRecord {
  return {
    id: "result-1",
    runId,
    traceId: "trace-1",
    intentType: "CREATE_PO",
    baselineDecision: "ALLOW",
    candidateDecision: "DENY",
    changed: true,
    baselinePolicyHash: "baseline",
    candidatePolicyHash: policyHash,
    baselineMatchedRules: [],
    candidateMatchedRules: [],
    candidateConstraintTypes: [],
    baselineRisk: { level: "low", signals: [] },
    reasons: [],
    categories: [],
    risk: { level: "low", signals: [] },
    createdAt
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.POLICY_PATH;
  delete process.env.POLICY_INLINE_ENABLED;
  delete process.env.PROMOTION_MAX_BLAST_RADIUS;
  delete process.env.PROMOTION_MAX_IMPACTED_INTENTS;
  delete process.env.PROMOTION_MAX_SEVERITY_DELTA;
  delete process.env.PROMOTION_MIN_HEALTH_STATE;
  delete process.env.PROMOTION_MAX_QUALITY_SCORE;
});

test("promotion guardrail check returns deterministic reasons", async () => {
  process.env.POLICY_PATH = writeTempPolicy(POLICY_INLINE);
  process.env.POLICY_INLINE_ENABLED = "true";
  process.env.PROMOTION_MAX_BLAST_RADIUS = "1";
  process.env.PROMOTION_MAX_IMPACTED_INTENTS = "0";
  process.env.PROMOTION_MAX_SEVERITY_DELTA = "0";
  process.env.PROMOTION_MIN_HEALTH_STATE = "HEALTHY";
  process.env.PROMOTION_MAX_QUALITY_SCORE = "0.1";

  const now = new Date();
  replayStore = new InMemoryPolicyReplayStore({
    baselineIntents: [buildBaselineIntent("baseline", now)]
  });
  lifecycleStore = new InMemoryPolicyLifecycleStore(() => now);
  lineageStore = new InMemoryPolicyLineageStore();
  outcomeStore = new InMemoryPolicyOutcomeStore();
  promotionStore = new InMemoryPolicyPromotionStore();

  const candidatePolicy = loadPolicyFromSource({ source: "inline", yaml: POLICY_STRICT, ref: "candidate" });
  lifecycleStore.registerDraft({
    hash: candidatePolicy.info.hash,
    source: "inline",
    ref: "inline",
    inlineYaml: POLICY_STRICT
  });

  const run = await replayStore.createRun({
    requestedBy: "tester",
    baselinePolicyHash: "baseline",
    candidatePolicyHash: candidatePolicy.info.hash,
    candidatePolicySource: "inline",
    candidatePolicyRef: "inline",
    intentTypeFilter: null,
    since: null,
    until: null,
    limit: 10
  });
  await replayStore.saveResults(run.id, [buildReplayResult(run.id, candidatePolicy.info.hash, now)]);

  await outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash: candidatePolicy.info.hash,
    decision: "DENY",
    outcomeType: "failure",
    severity: 5,
    humanOverride: false,
    observedAt: now
  });

  const app = await buildApp();
  const response = await app.inject({
    method: "GET",
    url: `/v1/policy/promote/check?policyHash=${candidatePolicy.info.hash}`
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json();
  expect(payload.allowed).toBe(false);
  const codes = payload.reasons.map((reason: { code: string }) => reason.code);
  const expectedOrder = [
    "BLAST_RADIUS_EXCEEDED",
    "IMPACTED_INTENTS_EXCEEDED",
    "SEVERITY_DELTA_EXCEEDED",
    "HEALTH_STATE_TOO_LOW",
    "QUALITY_SCORE_TOO_HIGH"
  ];
  const sortedByOrder = [...codes].sort((a, b) => expectedOrder.indexOf(a) - expectedOrder.indexOf(b));
  expect(codes).toEqual(sortedByOrder);
  expect(codes.length).toBeGreaterThan(0);

  await app.close();
});

test("promotion blocked returns 409 with decision payload", async () => {
  process.env.POLICY_PATH = writeTempPolicy(POLICY_INLINE);
  process.env.POLICY_INLINE_ENABLED = "true";
  process.env.PROMOTION_MAX_BLAST_RADIUS = "1";
  process.env.PROMOTION_MAX_IMPACTED_INTENTS = "0";
  process.env.PROMOTION_MAX_SEVERITY_DELTA = "0";
  process.env.PROMOTION_MIN_HEALTH_STATE = "HEALTHY";
  process.env.PROMOTION_MAX_QUALITY_SCORE = "0.1";

  const now = new Date();
  replayStore = new InMemoryPolicyReplayStore({
    baselineIntents: [buildBaselineIntent("baseline", now)]
  });
  lifecycleStore = new InMemoryPolicyLifecycleStore(() => now);
  lineageStore = new InMemoryPolicyLineageStore();
  outcomeStore = new InMemoryPolicyOutcomeStore();
  promotionStore = new InMemoryPolicyPromotionStore();

  const candidatePolicy = loadPolicyFromSource({ source: "inline", yaml: POLICY_STRICT, ref: "candidate" });
  lifecycleStore.registerDraft({
    hash: candidatePolicy.info.hash,
    source: "inline",
    ref: "inline",
    inlineYaml: POLICY_STRICT
  });

  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/promote",
    payload: {
      policyHash: candidatePolicy.info.hash,
      reviewer: "Reviewer",
      rationale: "Promotion rationale for guardrail test.",
      acceptedRisk: 10
    }
  });

  expect(response.statusCode).toBe(409);
  const payload = response.json();
  expect(payload.decision).toBeTruthy();

  await app.close();
});

test("force promote persists guardrail metadata", async () => {
  process.env.POLICY_PATH = writeTempPolicy(POLICY_INLINE);
  process.env.POLICY_INLINE_ENABLED = "true";
  process.env.PROMOTION_MAX_BLAST_RADIUS = "1";
  process.env.PROMOTION_MAX_IMPACTED_INTENTS = "0";
  process.env.PROMOTION_MAX_SEVERITY_DELTA = "0";
  process.env.PROMOTION_MIN_HEALTH_STATE = "HEALTHY";
  process.env.PROMOTION_MAX_QUALITY_SCORE = "0.1";

  const now = new Date();
  replayStore = new InMemoryPolicyReplayStore({
    baselineIntents: [buildBaselineIntent("baseline", now)]
  });
  lifecycleStore = new InMemoryPolicyLifecycleStore(() => now);
  lineageStore = new InMemoryPolicyLineageStore();
  outcomeStore = new InMemoryPolicyOutcomeStore();
  promotionStore = new InMemoryPolicyPromotionStore();

  const candidatePolicy = loadPolicyFromSource({ source: "inline", yaml: POLICY_STRICT, ref: "candidate" });
  lifecycleStore.registerDraft({
    hash: candidatePolicy.info.hash,
    source: "inline",
    ref: "inline",
    inlineYaml: POLICY_STRICT
  });

  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/promote",
    payload: {
      policyHash: candidatePolicy.info.hash,
      reviewer: "Reviewer",
      rationale: "Promotion rationale for guardrail test.",
      acceptedRisk: 10,
      force: true
    }
  });

  expect(response.statusCode).toBe(200);
  const stored = await promotionStore.listPromotions(candidatePolicy.info.hash);
  expect(stored.length).toBe(1);
  expect(stored[0].forced).toBe(true);

  await app.close();
});

test("promotion requires accepted risk when guardrails require acceptance", async () => {
  process.env.POLICY_PATH = writeTempPolicy(POLICY_INLINE);
  process.env.POLICY_INLINE_ENABLED = "true";
  process.env.PROMOTION_MAX_BLAST_RADIUS = "100";
  process.env.PROMOTION_MAX_IMPACTED_INTENTS = "100";
  process.env.PROMOTION_MAX_SEVERITY_DELTA = "100";
  process.env.PROMOTION_MIN_HEALTH_STATE = "WATCH";
  process.env.PROMOTION_MAX_QUALITY_SCORE = "100";

  const now = new Date();
  replayStore = new InMemoryPolicyReplayStore({
    baselineIntents: [buildBaselineIntent("baseline", now)]
  });
  lifecycleStore = new InMemoryPolicyLifecycleStore(() => now);
  lineageStore = new InMemoryPolicyLineageStore();
  outcomeStore = new InMemoryPolicyOutcomeStore();
  promotionStore = new InMemoryPolicyPromotionStore();

  const candidatePolicy = loadPolicyFromSource({ source: "inline", yaml: POLICY_INLINE, ref: "candidate" });
  lifecycleStore.registerDraft({
    hash: candidatePolicy.info.hash,
    source: "inline",
    ref: "inline",
    inlineYaml: POLICY_INLINE
  });

  await outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash: candidatePolicy.info.hash,
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: now
  });

  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/policy/promote",
    payload: {
      policyHash: candidatePolicy.info.hash,
      reviewer: "Reviewer",
      rationale: "Promotion rationale for guardrail test."
    }
  });

  expect(response.statusCode).toBe(400);

  await app.close();
});

const POLICY_INLINE = "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.4\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n";
const POLICY_STRICT = "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.9\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n";

import { afterEach, expect, test } from "vitest";
import { loadPolicyFromSource } from "../src/policy-code/loader";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import type { ReplayBaselineIntent, ReplayResultRecord } from "../src/policy-replay/types";
import { evaluatePromotionGuardrails } from "../src/policy-promotion-guardrails/compute";

const POLICY_INLINE = "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.4\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n";
const POLICY_STRICT = "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.9\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n";

function buildBaselineIntent(policyHash: string, createdAt: Date): ReplayBaselineIntent {
  return {
    traceId: "trace-1",
    intentType: "CREATE_PO",
    intent: {
      intentType: "CREATE_PO",
      entities: { quantity: 10, vendor: "VENDOR-1" },
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
  delete process.env.POLICY_INLINE_ENABLED;
});

test("guardrail reasons are ordered deterministically", async () => {
  process.env.POLICY_INLINE_ENABLED = "true";
  const currentPolicy = loadPolicyFromSource({ source: "inline", yaml: POLICY_INLINE, ref: "current" });
  const candidatePolicy = loadPolicyFromSource({ source: "inline", yaml: POLICY_STRICT, ref: "candidate" });

  const baselineIntents = [buildBaselineIntent(currentPolicy.info.hash, new Date("2024-02-27T00:00:00Z"))];
  const replayStore = new InMemoryPolicyReplayStore({ baselineIntents });
  const outcomeStore = new InMemoryPolicyOutcomeStore();
  const lineageStore = new InMemoryPolicyLineageStore();

  const run = await replayStore.createRun({
    requestedBy: "tester",
    baselinePolicyHash: currentPolicy.info.hash,
    candidatePolicyHash: candidatePolicy.info.hash,
    candidatePolicySource: "inline",
    candidatePolicyRef: "inline",
    intentTypeFilter: null,
    since: null,
    until: null,
    limit: 10
  });

  await replayStore.saveResults(run.id, [buildReplayResult(run.id, candidatePolicy.info.hash, new Date("2024-02-27T00:00:00Z"))]);

  await outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash: candidatePolicy.info.hash,
    decision: "DENY",
    outcomeType: "failure",
    severity: 5,
    humanOverride: false,
    observedAt: new Date("2024-02-27T12:00:00Z")
  });

  const decision = await evaluatePromotionGuardrails({
    policyHash: candidatePolicy.info.hash,
    candidatePolicy,
    currentPolicy,
    outcomeStore,
    replayStore,
    lineageStore,
    config: {
      enabled: true,
      thresholds: {
        maxBlastRadius: 1,
        maxImpactedIntents: 0,
        maxSeverityDelta: 0,
        minHealthState: "HEALTHY",
        maxQualityScore: 0.1
      },
      requireRationale: true,
      requireAcceptedRisk: true
    },
    executionMode: "manual",
    now: new Date("2024-03-01T00:00:00Z")
  });

  expect(decision.allowed).toBe(false);
  expect(decision.reasons.map((reason) => reason.code)).toEqual([
    "BLAST_RADIUS_EXCEEDED",
    "IMPACTED_INTENTS_EXCEEDED",
    "SEVERITY_DELTA_EXCEEDED",
    "HEALTH_STATE_TOO_LOW",
    "QUALITY_SCORE_TOO_HIGH"
  ]);
});

test("guardrail decision allows promotion when thresholds are met", async () => {
  process.env.POLICY_INLINE_ENABLED = "true";
  const currentPolicy = loadPolicyFromSource({ source: "inline", yaml: POLICY_INLINE, ref: "current" });
  const candidatePolicy = loadPolicyFromSource({ source: "inline", yaml: POLICY_INLINE, ref: "candidate" });

  const baselineIntents = [buildBaselineIntent(currentPolicy.info.hash, new Date("2024-02-27T00:00:00Z"))];
  const replayStore = new InMemoryPolicyReplayStore({ baselineIntents });
  const outcomeStore = new InMemoryPolicyOutcomeStore();
  const lineageStore = new InMemoryPolicyLineageStore();

  await outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash: candidatePolicy.info.hash,
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: new Date("2024-02-27T12:00:00Z")
  });

  const decision = await evaluatePromotionGuardrails({
    policyHash: candidatePolicy.info.hash,
    candidatePolicy,
    currentPolicy,
    outcomeStore,
    replayStore,
    lineageStore,
    config: {
      enabled: true,
      thresholds: {
        maxBlastRadius: 100,
        maxImpactedIntents: 100,
        maxSeverityDelta: 10,
        minHealthState: "WATCH",
        maxQualityScore: 100
      },
      requireRationale: true,
      requireAcceptedRisk: true
    },
    executionMode: "manual",
    now: new Date("2024-03-01T00:00:00Z")
  });

  expect(decision.allowed).toBe(true);
  expect(decision.requiredAcceptance).toBe(true);
  expect(decision.reasons).toEqual([]);
});

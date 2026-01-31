import { afterEach, expect, test } from "vitest";
import type { ReplayBaselineIntent } from "../src/policy-replay/types";
import type { Intent } from "../src/intent/intent-model";
import { loadPolicyFromSource } from "../src/policy-code/loader";
import { computePolicyImpactReport } from "../src/policy-impact/compute";

const baseIntent: Intent = {
  intentType: "CREATE_PO",
  entities: { amount: 1200, vendor: "ACME" },
  confidence: 0.8,
  rawText: "create PO"
};

function buildBaselineIntent(overrides?: Partial<ReplayBaselineIntent>): ReplayBaselineIntent {
  return {
    traceId: "trace-1",
    intentType: baseIntent.intentType,
    intent: baseIntent,
    createdAt: new Date("2024-02-01T00:00:00Z"),
    baselineDecision: "ALLOW",
    baselineMatchedRules: [],
    baselinePolicyHash: "baseline",
    baselineRisk: { level: "low", signals: [] },
    ...overrides
  };
}

function buildSnapshot(yaml: string) {
  return loadPolicyFromSource({ source: "inline", yaml });
}

afterEach(() => {
  delete process.env.POLICY_INLINE_ENABLED;
});

test("no changes produce zero blast radius", () => {
  process.env.POLICY_INLINE_ENABLED = "true";
  const yaml = "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.2\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n";
  const snapshot = buildSnapshot(yaml);
  const report = computePolicyImpactReport({
    currentPolicy: snapshot,
    candidatePolicy: snapshot,
    intents: [buildBaselineIntent()],
    window: { since: new Date("2024-02-01T00:00:00Z"), until: new Date("2024-02-02T00:00:00Z") },
    executionMode: "manual"
  });

  expect(report.blastRadiusScore).toBe(0);
  expect(report.rows[0].classifications).toEqual(["UNCHANGED"]);
});

test("newly blocked intents increase blast radius score", () => {
  process.env.POLICY_INLINE_ENABLED = "true";
  const current = buildSnapshot(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.2\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  const candidate = buildSnapshot(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.95\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );

  const report = computePolicyImpactReport({
    currentPolicy: current,
    candidatePolicy: candidate,
    intents: [buildBaselineIntent()],
    window: { since: new Date("2024-02-01T00:00:00Z"), until: new Date("2024-02-02T00:00:00Z") },
    executionMode: "manual"
  });

  expect(report.totals.newlyBlocked).toBe(1);
  expect(report.totals.severityIncreases).toBe(1);
  expect(report.blastRadiusScore).toBe(7);
});

test("approval escalation is detected", () => {
  process.env.POLICY_INLINE_ENABLED = "true";
  const current = buildSnapshot(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.2\n  execution:\n    autoRequires: [\"WARN\"]\nrules:\n  - id: warn-high\n    enabled: true\n    priority: 5\n    appliesTo:\n      intentTypes: [\"CREATE_PO\"]\n    constraints:\n      - type: MAX_AMOUNT\n        params:\n          max: 1000\n    decision: WARN\n    reason: \"Amount exceeds limit.\"\n    tags: [\"finance\"]\n"
  );
  const candidate = buildSnapshot(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.2\n  execution:\n    autoRequires: [\"WARN\"]\nrules:\n  - id: warn-high\n    enabled: true\n    priority: 5\n    appliesTo:\n      intentTypes: [\"CREATE_PO\"]\n    constraints:\n      - type: MAX_AMOUNT\n        params:\n          max: 1000\n    decision: WARN\n    reason: \"Amount exceeds limit.\"\n    tags: [\"finance\", \"compliance\"]\n"
  );

  const report = computePolicyImpactReport({
    currentPolicy: current,
    candidatePolicy: candidate,
    intents: [buildBaselineIntent({ intent: baseIntent })],
    window: { since: new Date("2024-02-01T00:00:00Z"), until: new Date("2024-02-02T00:00:00Z") },
    executionMode: "manual"
  });

  expect(report.totals.approvalEscalations).toBe(1);
  expect(report.rows[0].classifications).toContain("APPROVAL_ESCALATED");
});

test("impact report computation is deterministic", () => {
  process.env.POLICY_INLINE_ENABLED = "true";
  const current = buildSnapshot(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.2\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  const candidate = buildSnapshot(
    "version: \"v1\"\ndefaults:\n  confidenceThreshold: 0.95\n  execution:\n    autoRequires: [\"WARN\"]\nrules: []\n"
  );
  const intents = [buildBaselineIntent()];
  const window = { since: new Date("2024-02-01T00:00:00Z"), until: new Date("2024-02-02T00:00:00Z") };

  const first = computePolicyImpactReport({
    currentPolicy: current,
    candidatePolicy: candidate,
    intents,
    window,
    executionMode: "manual"
  });
  const second = computePolicyImpactReport({
    currentPolicy: current,
    candidatePolicy: candidate,
    intents,
    window,
    executionMode: "manual"
  });

  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

import { expect, test } from "vitest";
import { buildDecisionRationale } from "../src/decision-rationale/build";
import type { PolicyDecisionResult } from "../src/policy-code/types";
import type { PolicyDecisionRecord } from "../src/policy/policy-store";

const policyDecision: PolicyDecisionResult = {
  final: "ALLOW",
  matchedRules: [
    {
      ruleId: "rule-1",
      decision: "ALLOW",
      reason: "Approved baseline.",
      tags: [],
      priority: 1,
      constraintTypes: []
    }
  ],
  reasons: [{ ruleId: "rule-1", decision: "ALLOW", reason: "Approved baseline." }],
  categories: ["baseline"],
  risk: { level: "low", signals: [] },
  executionMode: "manual",
  policy: {
    version: "v1",
    hash: "policy-hash",
    loadedAt: "2024-04-01T00:00:00.000Z",
    path: "policies/policies.v1.yaml"
  },
  simulationAllowed: true,
  requiredApprovals: []
};

const decisionRecord: PolicyDecisionRecord = {
  id: "decision-1",
  traceId: "trace-1",
  policyHash: "policy-hash",
  decision: "ALLOW",
  matchedRuleIds: ["rule-1"],
  reasons: [{ ruleId: "rule-1", decision: "ALLOW", reason: "Approved baseline." }],
  categories: ["baseline"],
  risk: { level: "low", signals: [] },
  createdAt: new Date("2024-04-02T10:05:00.000Z")
};

test("confidence score uses deterministic weighted inputs", () => {
  const rationale = buildDecisionRationale({
    decisionType: "EXECUTION",
    traceId: "trace-1",
    policyHash: "policy-hash",
    policyDecision,
    decisionRecord,
    approvals: [],
    totalRules: 4
  });

  expect(rationale.confidenceScore).toBe(0.67);
});

test("decision ids are stable for identical inputs", () => {
  const first = buildDecisionRationale({
    decisionType: "EXECUTION",
    traceId: "trace-1",
    policyHash: "policy-hash",
    policyDecision,
    decisionRecord,
    approvals: [],
    totalRules: 4
  });

  const second = buildDecisionRationale({
    decisionType: "EXECUTION",
    traceId: "trace-1",
    policyHash: "policy-hash",
    policyDecision,
    decisionRecord,
    approvals: [],
    totalRules: 4
  });

  expect(first.decisionId).toBe(second.decisionId);
  expect(first).toEqual(second);
});

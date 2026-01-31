import { expect, test } from "vitest";
import type { PolicyDocument } from "../src/policy-code/types";
import { buildReconcileReport } from "../src/policy-rollback/reconcile";

const basePolicy: PolicyDocument = {
  version: "v1",
  defaults: {
    confidenceThreshold: 0.6,
    execution: { autoRequires: ["WARN"] }
  },
  rules: [
    {
      id: "rule-a",
      enabled: true,
      priority: 10.12345,
      appliesTo: { intentTypes: ["CREATE_PO"] },
      constraints: [{ type: "CONFIDENCE_MIN", params: { min: 0.5 } }],
      decision: "WARN",
      reason: "Base rule",
      tags: ["finance"]
    }
  ]
};

const updatedPolicy: PolicyDocument = {
  version: "v1",
  defaults: {
    confidenceThreshold: 0.61,
    execution: { autoRequires: ["WARN", "ALLOW_ONLY"] }
  },
  rules: [
    {
      id: "rule-b",
      enabled: true,
      priority: 5,
      appliesTo: { intentTypes: ["CHECK_INVENTORY"] },
      constraints: [],
      decision: "DENY",
      reason: "New rule",
      tags: ["ops"]
    },
    {
      id: "rule-a",
      enabled: true,
      priority: 12,
      appliesTo: { intentTypes: ["CREATE_PO", "CHECK_INVENTORY"] },
      constraints: [{ type: "CONFIDENCE_MIN", params: { min: 0.4 } }],
      decision: "WARN",
      reason: "Updated rule",
      tags: ["finance", "compliance"]
    }
  ]
};

test("reconcile report is deterministic and stable", () => {
  const first = buildReconcileReport({
    fromPolicyHash: "hash-a",
    toPolicyHash: "hash-b",
    fromPolicy: basePolicy,
    toPolicy: updatedPolicy
  });

  const second = buildReconcileReport({
    fromPolicyHash: "hash-a",
    toPolicyHash: "hash-b",
    fromPolicy: basePolicy,
    toPolicy: updatedPolicy
  });

  expect(first.reportHash).toBe(second.reportHash);
  expect(first.summary.rulesAdded).toBe(1);
  expect(first.summary.rulesModified).toBe(1);
  expect(first.summary.defaultsChanged).toBe(true);
  expect(first.rulesAdded[0]?.ruleId).toBe("rule-b");
  expect(first.rulesModified[0]?.ruleId).toBe("rule-a");
});

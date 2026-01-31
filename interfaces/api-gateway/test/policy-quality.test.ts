import { expect, test } from "vitest";
import { calculatePolicyQuality } from "../src/policy-quality/score";
import type { PolicyOutcomeRecord } from "../src/policy-outcomes/types";

function buildOutcome(partial: Partial<PolicyOutcomeRecord>): PolicyOutcomeRecord {
  return {
    id: partial.id ?? "outcome-1",
    traceId: partial.traceId ?? "trace-1",
    intentType: partial.intentType ?? "CREATE_PO",
    policyHash: partial.policyHash ?? "policy-hash",
    decision: partial.decision ?? "ALLOW",
    outcomeType: partial.outcomeType ?? "success",
    severity: partial.severity ?? 1,
    humanOverride: partial.humanOverride ?? false,
    notes: partial.notes ?? null,
    observedAt: partial.observedAt ?? new Date("2024-02-01T00:00:00Z"),
    createdAt: partial.createdAt ?? new Date("2024-02-01T00:00:00Z")
  };
}

test("policy quality scoring is deterministic", () => {
  const outcomes: PolicyOutcomeRecord[] = [
    buildOutcome({ id: "o1", outcomeType: "failure", severity: 5 }),
    buildOutcome({ id: "o2", outcomeType: "override", severity: 2 }),
    buildOutcome({ id: "o3", outcomeType: "success", severity: 1 })
  ];

  const metrics = calculatePolicyQuality(outcomes);
  expect(metrics.totalOutcomes).toBe(3);
  expect(metrics.failureRate).toBeCloseTo(1 / 3, 5);
  expect(metrics.overrideRate).toBeCloseTo(1 / 3, 5);
  expect(metrics.weightedPenalty).toBe(17);
  expect(metrics.qualityScore).toBeCloseTo(62.2222, 3);
});

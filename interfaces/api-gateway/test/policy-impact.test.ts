import { expect, test } from "vitest";
import { calculatePolicyImpact } from "../src/policy-lifecycle/impact";
import type { ReplayResultRecord } from "../src/policy-replay/types";

const baseResult: ReplayResultRecord = {
  id: "res-1",
  runId: "run-1",
  traceId: "trace-1",
  intentType: "CREATE_PO",
  baselineDecision: "ALLOW",
  candidateDecision: "DENY",
  changed: true,
  baselinePolicyHash: "base-hash",
  candidatePolicyHash: "cand-hash",
  baselineMatchedRules: [],
  candidateMatchedRules: [],
  candidateConstraintTypes: [],
  reasons: [],
  categories: [],
  risk: { level: "low", signals: [] },
  createdAt: new Date("2024-02-01T00:00:00Z")
};

test("impact scoring aggregates weighted counts deterministically", () => {
  const results: ReplayResultRecord[] = [
    {
      ...baseResult,
      id: "res-1",
      baselineDecision: "DENY",
      candidateDecision: "ALLOW",
      candidateConstraintTypes: ["RATE_LIMIT"],
      risk: { level: "high", signals: [{ key: "quantity", value: 9000, note: "high" }] }
    },
    { ...baseResult, id: "res-2", changed: false }
  ];

  const impact = calculatePolicyImpact(results, {
    weights: {
      changedDecisions: 1,
      denyToAllowFlips: 5,
      rateLimitViolations: 3,
      highRiskSignals: 2
    },
    thresholds: {
      score: 100,
      changedDecisions: 10,
      denyToAllowFlips: 10,
      rateLimitViolations: 10,
      highRiskSignals: 10
    }
  });

  expect(impact.counts).toEqual({
    changedDecisions: 1,
    denyToAllowFlips: 1,
    rateLimitViolations: 1,
    highRiskSignals: 1
  });
  expect(impact.score).toBe(11);
  expect(impact.blocked).toBe(false);
});

test("impact guardrails block promotion when thresholds exceeded", () => {
  const results: ReplayResultRecord[] = Array.from({ length: 30 }, (_, index) => ({
    ...baseResult,
    id: `res-${index}`,
    traceId: `trace-${index}`
  }));

  const impact = calculatePolicyImpact(results, {
    weights: {
      changedDecisions: 1,
      denyToAllowFlips: 1,
      rateLimitViolations: 1,
      highRiskSignals: 1
    },
    thresholds: {
      score: 100,
      changedDecisions: 25,
      denyToAllowFlips: 25,
      rateLimitViolations: 25,
      highRiskSignals: 25
    }
  });

  expect(impact.blocked).toBe(true);
  expect(impact.exceeded).toContain("changedDecisions");
});

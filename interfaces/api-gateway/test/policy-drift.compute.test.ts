import { expect, test } from "vitest";
import { computePolicyDriftReport } from "../src/policy-drift/compute";
import type { PolicyOutcomeRecord } from "../src/policy-outcomes/types";

function buildOutcome(partial: Partial<PolicyOutcomeRecord>): PolicyOutcomeRecord {
  return {
    id: partial.id ?? "outcome-1",
    traceId: partial.traceId ?? "trace-1",
    intentType: partial.intentType ?? "CREATE_PO",
    policyHash: partial.policyHash ?? "policy-1",
    decision: partial.decision ?? "ALLOW",
    outcomeType: partial.outcomeType ?? "success",
    severity: partial.severity ?? 1,
    humanOverride: partial.humanOverride ?? false,
    notes: partial.notes ?? null,
    observedAt: partial.observedAt ?? new Date("2024-02-01T00:00:00Z"),
    createdAt: partial.createdAt ?? new Date("2024-02-01T00:00:00Z")
  };
}

test("computes critical drift health with deterministic rationale", () => {
  const recentOutcomes = Array.from({ length: 6 }, (_, index) =>
    buildOutcome({
      id: `recent-${index}`,
      outcomeType: "failure",
      severity: 5,
      observedAt: new Date("2024-02-10T00:00:00Z")
    })
  );
  const baselineOutcomes = Array.from({ length: 6 }, (_, index) =>
    buildOutcome({
      id: `baseline-${index}`,
      outcomeType: "success",
      severity: 1,
      observedAt: new Date("2024-01-10T00:00:00Z")
    })
  );

  const report = computePolicyDriftReport({
    policyHash: "policy-1",
    recent: {
      window: { since: new Date("2024-02-03T00:00:00Z"), until: new Date("2024-02-10T00:00:00Z") },
      outcomes: recentOutcomes,
      replayAdded: 40,
      replayRemoved: 15
    },
    baseline: {
      window: { since: new Date("2024-01-04T00:00:00Z"), until: new Date("2024-02-03T00:00:00Z") },
      outcomes: baselineOutcomes,
      replayAdded: 0,
      replayRemoved: 0
    }
  });

  expect(report.health.state).toBe("CRITICAL");
  expect(report.health.rationale).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/qualityScore < 60/),
      expect.stringMatching(/failureRate > 0.20/),
      expect.stringMatching(/replayDelta >= 50/)
    ])
  );
});

test("flags watch state when failure rate delta crosses threshold", () => {
  const recentOutcomes = [
    buildOutcome({ id: "recent-1", outcomeType: "failure", severity: 1, observedAt: new Date("2024-02-10T00:00:00Z") }),
    ...Array.from({ length: 19 }, (_, index) =>
      buildOutcome({
        id: `recent-${index + 2}`,
        outcomeType: "success",
        severity: 1,
        observedAt: new Date("2024-02-10T00:00:00Z")
      })
    )
  ];
  const baselineOutcomes = Array.from({ length: 20 }, (_, index) =>
    buildOutcome({
      id: `baseline-${index}`,
      outcomeType: "success",
      severity: 1,
      observedAt: new Date("2024-01-10T00:00:00Z")
    })
  );

  const report = computePolicyDriftReport({
    policyHash: "policy-1",
    recent: {
      window: { since: new Date("2024-02-03T00:00:00Z"), until: new Date("2024-02-10T00:00:00Z") },
      outcomes: recentOutcomes,
      replayAdded: 2,
      replayRemoved: 1
    },
    baseline: {
      window: { since: new Date("2024-01-04T00:00:00Z"), until: new Date("2024-02-03T00:00:00Z") },
      outcomes: baselineOutcomes,
      replayAdded: 2,
      replayRemoved: 1
    }
  });

  expect(report.health.state).toBe("WATCH");
  expect(report.health.rationale).toEqual(
    expect.arrayContaining([expect.stringMatching(/failureRateDelta >= 0.05/)])
  );
});

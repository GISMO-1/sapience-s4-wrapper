import { expect, test } from "vitest";
import { buildEventHash } from "../src/policy-events/hash";
import type { PolicyEvent } from "../src/policy-events/types";
import { replayEventLog } from "../src/policy-verifier/replay";

function makeEvent(event: Omit<PolicyEvent, "eventHash">): PolicyEvent {
  return { ...event, eventHash: buildEventHash(event) } as PolicyEvent;
}

test("replayEventLog produces deterministic snapshot independent of event order", () => {
  const baseEvent = {
    actor: "reviewer",
    traceId: null,
    policyHash: "policy-1",
    parentEventId: null
  };

  const events: PolicyEvent[] = [
    makeEvent({
      ...baseEvent,
      eventId: "outcome-1",
      occurredAt: "2024-02-10T10:00:00Z",
      kind: "POLICY_OUTCOME_RECORDED",
      payload: {
        outcomeId: "outcome-1",
        traceId: "trace-1",
        intentType: "CREATE_PO",
        decision: "ALLOW",
        outcomeType: "success",
        severity: 1,
        humanOverride: false,
        notes: null
      }
    }),
    makeEvent({
      ...baseEvent,
      eventId: "approval-1",
      occurredAt: "2024-02-10T11:00:00Z",
      kind: "POLICY_APPROVAL_RECORDED",
      payload: {
        approvalId: "approval-1",
        approvedBy: "reviewer",
        rationale: "Approved",
        acceptedRiskScore: 5,
        notes: null,
        runId: null,
        approvedAt: "2024-02-10T11:00:00Z"
      }
    }),
    makeEvent({
      ...baseEvent,
      eventId: "promotion-1",
      occurredAt: "2024-02-10T12:00:00Z",
      kind: "POLICY_PROMOTED",
      payload: {
        parentPolicyHash: "policy-0",
        promotedBy: "reviewer",
        rationale: "Promoted",
        acceptedRiskScore: 5,
        source: "manual",
        drift: {
          constraintsAdded: 1,
          constraintsRemoved: 0,
          severityDelta: 1,
          netRiskScoreChange: 0
        }
      }
    })
  ];

  const snapshotA = replayEventLog({
    policyHash: "policy-1",
    events
  });

  const snapshotB = replayEventLog({
    policyHash: "policy-1",
    events: events.slice().reverse()
  });

  expect(snapshotB).toEqual(snapshotA);
  expect(snapshotA.lifecycle.state).toBe("ACTIVE");
  expect(snapshotA.quality.totalOutcomes).toBe(1);
});

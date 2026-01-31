import { afterEach, expect, test, vi } from "vitest";
import { buildPolicyEventLog } from "../src/policy-events/projector";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryGuardrailCheckStore } from "../src/policy-promotion-guardrails/store";
import { InMemoryPolicyApprovalStore } from "../src/policy-approvals/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";

afterEach(() => {
  vi.useRealTimers();
});

test("buildPolicyEventLog returns stable ordering and hashes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-02-10T12:00:00Z"));

  const replayStore = new InMemoryPolicyReplayStore();
  const outcomeStore = new InMemoryPolicyOutcomeStore();
  const guardrailCheckStore = new InMemoryGuardrailCheckStore();
  const approvalStore = new InMemoryPolicyApprovalStore();
  const lineageStore = new InMemoryPolicyLineageStore();

  const run = await replayStore.createRun({
    baselinePolicyHash: "base-1",
    candidatePolicyHash: "policy-1",
    candidatePolicySource: "current",
    limit: 1,
    requestedBy: "analyst"
  });

  await replayStore.saveResults(run.id, [
    {
      id: "result-1",
      runId: run.id,
      traceId: "trace-1",
      intentType: "CREATE_PO",
      baselineDecision: "ALLOW",
      candidateDecision: "DENY",
      changed: true,
      baselinePolicyHash: "base-1",
      candidatePolicyHash: "policy-1",
      baselineMatchedRules: ["rule-1"],
      candidateMatchedRules: ["rule-1", "rule-2"],
      candidateConstraintTypes: [],
      baselineRisk: { level: "low", signals: [] },
      reasons: [],
      categories: [],
      risk: { level: "medium", signals: [] },
      createdAt: new Date("2024-02-10T12:05:00Z")
    }
  ]);

  await outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash: "policy-1",
    decision: "DENY",
    outcomeType: "failure",
    severity: 2,
    humanOverride: false,
    observedAt: new Date("2024-02-10T13:00:00Z")
  });

  await guardrailCheckStore.recordCheck({
    policyHash: "policy-1",
    evaluatedAt: "2024-02-10T14:00:00Z",
    actor: "reviewer",
    rationale: "Guardrail check",
    decision: {
      allowed: true,
      requiredAcceptance: false,
      reasons: [],
      snapshot: {
        policyHash: "policy-1",
        evaluatedAt: "2024-02-10T14:00:00Z",
        drift: {
          policyHash: "policy-1",
          recent: {
            window: { since: "2024-02-01T00:00:00Z", until: "2024-02-08T00:00:00Z" },
            metrics: {
              totalOutcomes: 1,
              failureRate: 0,
              overrideRate: 0,
              qualityScore: 100,
              replayAdded: 0,
              replayRemoved: 0
            }
          },
          baseline: {
            window: { since: "2024-01-01T00:00:00Z", until: "2024-02-01T00:00:00Z" },
            metrics: {
              totalOutcomes: 1,
              failureRate: 0,
              overrideRate: 0,
              qualityScore: 100,
              replayAdded: 0,
              replayRemoved: 0
            }
          },
          deltas: {
            failureRateDelta: 0,
            overrideRateDelta: 0,
            qualityScoreDelta: 0,
            replayDelta: 0
          },
          health: { state: "HEALTHY", rationale: [] }
        },
        impact: {
          policyHashCurrent: "policy-0",
          policyHashCandidate: "policy-1",
          window: { since: "2024-02-01T00:00:00Z", until: "2024-02-08T00:00:00Z" },
          totals: {
            intentsEvaluated: 1,
            newlyBlocked: 0,
            newlyAllowed: 0,
            approvalEscalations: 0,
            severityIncreases: 0
          },
          blastRadiusScore: 0,
          rows: [],
          impactedIntents: 0
        },
        quality: {
          totalOutcomes: 1,
          failureRate: 0,
          overrideRate: 0,
          weightedPenalty: 0,
          qualityScore: 100,
          score: 100
        },
        lineageHead: null
      }
    }
  });

  await approvalStore.recordApproval({
    policyHash: "policy-1",
    approvedBy: "reviewer",
    approvedAt: "2024-02-10T14:30:00Z",
    rationale: "Approved",
    acceptedRiskScore: 10,
    notes: "Ready",
    runId: run.id
  });

  await lineageStore.createLineage({
    policyHash: "policy-1",
    parentPolicyHash: "policy-0",
    promotedBy: "reviewer",
    promotedAt: "2024-02-10T15:00:00Z",
    rationale: "Promoted",
    acceptedRiskScore: 10,
    source: "manual",
    drift: { constraintsAdded: 1, constraintsRemoved: 0, severityDelta: 1, netRiskScoreChange: 0 }
  });

  const events = await buildPolicyEventLog({
    policyHash: "policy-1",
    stores: {
      replayStore,
      outcomeStore,
      guardrailCheckStore,
      approvalStore,
      lineageStore
    }
  });

  const eventsRepeat = await buildPolicyEventLog({
    policyHash: "policy-1",
    stores: {
      replayStore,
      outcomeStore,
      guardrailCheckStore,
      approvalStore,
      lineageStore
    }
  });

  expect(eventsRepeat).toEqual(events);
  expect(events.length).toBeGreaterThan(0);

  for (let index = 1; index < events.length; index += 1) {
    const prev = events[index - 1];
    const current = events[index];
    const prevTime = new Date(prev.occurredAt).getTime();
    const currentTime = new Date(current.occurredAt).getTime();
    expect(currentTime).toBeGreaterThanOrEqual(prevTime);
  }

  events.forEach((event) => {
    expect(event.eventHash.length).toBeGreaterThan(10);
  });
});

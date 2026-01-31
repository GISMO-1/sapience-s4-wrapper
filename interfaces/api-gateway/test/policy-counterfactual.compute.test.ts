import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { InMemoryPolicyOutcomeStore } from "../src/policy-outcomes/store";
import { InMemoryPolicyReplayStore } from "../src/policy-replay/replay-store";
import { InMemoryPolicyLifecycleStore } from "../src/policy-lifecycle/store";
import { InMemoryPolicyLineageStore } from "../src/policy-lineage/store";
import { buildPolicyCounterfactualReport } from "../src/policy-counterfactual/compute";

async function seedStores() {
  const outcomeStore = new InMemoryPolicyOutcomeStore();
  const replayStore = new InMemoryPolicyReplayStore();
  const lifecycleStore = new InMemoryPolicyLifecycleStore(() => new Date("2024-02-03T00:00:00Z"));
  const lineageStore = new InMemoryPolicyLineageStore();

  const baselinePolicyHash = "policy-baseline";
  const candidatePolicyHash = "policy-candidate";

  lifecycleStore.setActivePolicy({
    hash: baselinePolicyHash,
    version: "v1",
    path: "policies.v1.yaml",
    loadedAt: "2024-02-01T00:00:00Z"
  });

  await outcomeStore.recordOutcome({
    traceId: "trace-1",
    intentType: "CREATE_PO",
    policyHash: baselinePolicyHash,
    decision: "ALLOW",
    outcomeType: "success",
    severity: 1,
    humanOverride: false,
    observedAt: new Date("2024-02-01T10:00:00Z")
  });

  await outcomeStore.recordOutcome({
    traceId: "trace-2",
    intentType: "REVIEW_INVOICE",
    policyHash: baselinePolicyHash,
    decision: "WARN",
    outcomeType: "override",
    severity: 2,
    humanOverride: true,
    observedAt: new Date("2024-02-01T11:00:00Z")
  });

  const run = await replayStore.createRun({
    baselinePolicyHash,
    candidatePolicyHash,
    candidatePolicySource: "current",
    candidatePolicyRef: null,
    intentTypeFilter: null,
    since: new Date("2024-02-01T00:00:00Z"),
    until: new Date("2024-02-02T00:00:00Z"),
    limit: 50
  });

  await replayStore.saveResults(run.id, [
    {
      id: randomUUID(),
      runId: run.id,
      traceId: "trace-1",
      intentType: "CREATE_PO",
      baselineDecision: "ALLOW",
      candidateDecision: "DENY",
      changed: true,
      baselinePolicyHash,
      candidatePolicyHash,
      baselineMatchedRules: [],
      candidateMatchedRules: [],
      candidateConstraintTypes: [],
      baselineRisk: { level: "low", signals: [] },
      reasons: [],
      categories: [],
      risk: { level: "medium", signals: [] },
      createdAt: new Date("2024-02-02T00:00:00Z")
    },
    {
      id: randomUUID(),
      runId: run.id,
      traceId: "trace-2",
      intentType: "REVIEW_INVOICE",
      baselineDecision: "WARN",
      candidateDecision: "WARN",
      changed: false,
      baselinePolicyHash,
      candidatePolicyHash,
      baselineMatchedRules: [],
      candidateMatchedRules: [],
      candidateConstraintTypes: [],
      baselineRisk: { level: "low", signals: [] },
      reasons: [],
      categories: [],
      risk: { level: "low", signals: [] },
      createdAt: new Date("2024-02-02T00:00:00Z")
    }
  ]);

  return { outcomeStore, replayStore, lifecycleStore, lineageStore, baselinePolicyHash, candidatePolicyHash };
}

test("counterfactual report hash is deterministic", async () => {
  const stores = await seedStores();

  const first = await buildPolicyCounterfactualReport({
    policyHash: stores.candidatePolicyHash,
    compareToPolicyHash: stores.baselinePolicyHash,
    since: "2024-02-01T00:00:00Z",
    until: "2024-02-02T00:00:00Z",
    outcomeStore: stores.outcomeStore,
    replayStore: stores.replayStore,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore
  });

  const second = await buildPolicyCounterfactualReport({
    policyHash: stores.candidatePolicyHash,
    compareToPolicyHash: stores.baselinePolicyHash,
    since: "2024-02-01T00:00:00Z",
    until: "2024-02-02T00:00:00Z",
    outcomeStore: stores.outcomeStore,
    replayStore: stores.replayStore,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore
  });

  expect(first.reportHash).toBe(second.reportHash);
});

test("counterfactual outcomes are sorted deterministically", async () => {
  const stores = await seedStores();

  const report = await buildPolicyCounterfactualReport({
    policyHash: stores.candidatePolicyHash,
    compareToPolicyHash: stores.baselinePolicyHash,
    since: "2024-02-01T00:00:00Z",
    until: "2024-02-02T00:00:00Z",
    outcomeStore: stores.outcomeStore,
    replayStore: stores.replayStore,
    lifecycleStore: stores.lifecycleStore,
    lineageStore: stores.lineageStore
  });

  const outcomeTypes = report.outcomes.map((entry) => entry.outcomeType);
  const sorted = [...outcomeTypes].sort((a, b) => a.localeCompare(b));
  expect(outcomeTypes).toEqual(sorted);
});

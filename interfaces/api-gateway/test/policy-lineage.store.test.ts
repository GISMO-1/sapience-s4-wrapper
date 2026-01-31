import { beforeEach, expect, test, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(() => ({ query }))
}));

import { InMemoryPolicyLineageStore, PostgresPolicyLineageStore } from "../src/policy-lineage/store";

const sampleInput = {
  policyHash: "policy-1",
  parentPolicyHash: "policy-0",
  promotedBy: "Reviewer",
  promotedAt: "2024-02-01T10:00:00Z",
  rationale: "Regression results match baseline.",
  acceptedRiskScore: 12,
  source: "replay" as const,
  drift: {
    constraintsAdded: 2,
    constraintsRemoved: 1,
    severityDelta: 1,
    netRiskScoreChange: 1
  }
};

beforeEach(() => {
  query.mockReset();
});

test("in-memory lineage store tracks chain", async () => {
  const store = new InMemoryPolicyLineageStore();
  await store.createLineage(sampleInput);
  await store.createLineage({
    ...sampleInput,
    policyHash: "policy-0",
    parentPolicyHash: null
  });

  const chain = await store.getLineageChain("policy-1");
  expect(chain.map((entry) => entry.policyHash)).toEqual(["policy-1", "policy-0"]);
});

test("postgres lineage store maps rows", async () => {
  const store = new PostgresPolicyLineageStore();
  query.mockResolvedValueOnce({ rows: [] });
  await store.createLineage(sampleInput);

  query.mockResolvedValueOnce({
    rows: [
      {
        policy_hash: "policy-1",
        parent_policy_hash: "policy-0",
        promoted_by: "Reviewer",
        promoted_at: new Date("2024-02-01T10:00:00Z"),
        rationale: "Regression results match baseline.",
        accepted_risk_score: "12",
        source: "replay",
        constraints_added: 2,
        constraints_removed: 1,
        severity_delta: 1,
        net_risk_score_change: 1
      }
    ]
  });

  const record = await store.getLineage("policy-1");
  expect(record?.policyHash).toBe("policy-1");
  expect(record?.promotedAt).toBe("2024-02-01T10:00:00.000Z");

  query.mockResolvedValueOnce({
    rows: [
      {
        policy_hash: "policy-1",
        parent_policy_hash: "policy-0",
        promoted_by: "Reviewer",
        promoted_at: new Date("2024-02-01T10:00:00Z"),
        rationale: "Regression results match baseline.",
        accepted_risk_score: "12",
        source: "replay",
        constraints_added: 2,
        constraints_removed: 1,
        severity_delta: 1,
        net_risk_score_change: 1
      },
      {
        policy_hash: "policy-0",
        parent_policy_hash: null,
        promoted_by: "Reviewer",
        promoted_at: new Date("2024-01-01T10:00:00Z"),
        rationale: "Initial baseline.",
        accepted_risk_score: "10",
        source: "manual",
        constraints_added: 0,
        constraints_removed: 0,
        severity_delta: 0,
        net_risk_score_change: 0
      }
    ]
  });

  const chain = await store.getLineageChain("policy-1");
  expect(chain).toHaveLength(2);
  expect(chain[1].policyHash).toBe("policy-0");
});

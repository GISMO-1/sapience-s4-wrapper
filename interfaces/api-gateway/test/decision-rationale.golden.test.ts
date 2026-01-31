import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { buildDecisionRationale } from "../src/decision-rationale/build";
import type { PolicyDecisionResult } from "../src/policy-code/types";
import type { PolicyDecisionRecord } from "../src/policy/policy-store";
import type { GuardrailDecision } from "../src/policy-promotion-guardrails/types";
import type { PolicyPromotionRecord } from "../src/policy-promotions/types";
import type { RollbackDecision, RollbackEvent } from "../src/policy-rollback/types";
import type { BlastRadiusReport } from "../src/policy-counterfactual/types";

const fixturesDir = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(fixturesDir, "fixtures", "decision-rationale.golden.json");

const basePolicy: PolicyDecisionResult["policy"] = {
  version: "v1",
  hash: "policy-hash-a",
  loadedAt: "2024-04-01T00:00:00.000Z",
  path: "policies/policies.v1.yaml"
};

const execDecisionA: PolicyDecisionResult = {
  final: "ALLOW",
  matchedRules: [
    {
      ruleId: "rule-1",
      decision: "ALLOW",
      reason: "Within baseline guardrails.",
      tags: [],
      priority: 1,
      constraintTypes: []
    }
  ],
  reasons: [{ ruleId: "rule-1", decision: "ALLOW", reason: "Within baseline guardrails." }],
  categories: ["baseline"],
  risk: { level: "low", signals: [] },
  executionMode: "manual",
  policy: basePolicy,
  simulationAllowed: true,
  requiredApprovals: []
};

const execDecisionB: PolicyDecisionResult = {
  final: "WARN",
  matchedRules: [
    {
      ruleId: "rule-2",
      decision: "WARN",
      reason: "Requires manual approval.",
      tags: [],
      priority: 2,
      constraintTypes: ["CONFIDENCE_MIN"]
    }
  ],
  reasons: [{ ruleId: "rule-2", decision: "WARN", reason: "Requires manual approval." }],
  categories: ["review"],
  risk: { level: "medium", signals: [{ key: "confidence", value: 0.52, note: "Low confidence intent." }] },
  executionMode: "manual",
  policy: basePolicy,
  simulationAllowed: true,
  requiredApprovals: [{ role: "OPS_REVIEWER", reason: "Low confidence." }]
};

const execRecordA: PolicyDecisionRecord = {
  id: "decision-a",
  traceId: "trace-a",
  policyHash: "policy-hash-a",
  decision: "ALLOW",
  matchedRuleIds: ["rule-1"],
  reasons: execDecisionA.reasons,
  categories: execDecisionA.categories,
  risk: execDecisionA.risk,
  createdAt: new Date("2024-04-02T09:00:00.000Z")
};

const execRecordB: PolicyDecisionRecord = {
  id: "decision-b",
  traceId: "trace-b",
  policyHash: "policy-hash-a",
  decision: "WARN",
  matchedRuleIds: ["rule-2"],
  reasons: execDecisionB.reasons,
  categories: execDecisionB.categories,
  risk: execDecisionB.risk,
  createdAt: new Date("2024-04-02T10:00:00.000Z")
};

const guardrailDecision: GuardrailDecision = {
  allowed: true,
  requiredAcceptance: true,
  reasons: [
    {
      code: "BLAST_RADIUS_EXCEEDED",
      message: "Blast radius exceeds threshold.",
      metric: 42,
      threshold: 25
    }
  ],
  snapshot: {
    policyHash: "policy-hash-b",
    evaluatedAt: "2024-05-01T10:00:00.000Z",
    drift: {
      policyHash: "policy-hash-b",
      recent: {
        window: { since: "2024-04-01T00:00:00.000Z", until: "2024-05-01T00:00:00.000Z" },
        metrics: {
          totalOutcomes: 12,
          failureRate: 0.1,
          overrideRate: 0.05,
          qualityScore: 95,
          replayAdded: 2,
          replayRemoved: 1
        }
      },
      baseline: {
        window: { since: "2024-03-01T00:00:00.000Z", until: "2024-04-01T00:00:00.000Z" },
        metrics: {
          totalOutcomes: 10,
          failureRate: 0.08,
          overrideRate: 0.04,
          qualityScore: 96,
          replayAdded: 1,
          replayRemoved: 0
        }
      },
      deltas: {
        failureRateDelta: 0.02,
        overrideRateDelta: 0.01,
        qualityScoreDelta: -1,
        replayDelta: 1
      },
      health: {
        state: "WATCH",
        rationale: ["blastRadiusScore >= 25 (42.0000)"]
      }
    },
    impact: {
      policyHashCurrent: "policy-hash-a",
      policyHashCandidate: "policy-hash-b",
      window: { since: "2024-04-01T00:00:00.000Z", until: "2024-05-01T00:00:00.000Z" },
      totals: {
        intentsEvaluated: 15,
        newlyBlocked: 2,
        newlyAllowed: 1,
        approvalEscalations: 3,
        severityIncreases: 1
      },
      blastRadiusScore: 42,
      rows: [],
      impactedIntents: 4
    },
    quality: {
      totalOutcomes: 12,
      failureRate: 0.1,
      overrideRate: 0.05,
      weightedPenalty: 0.2,
      qualityScore: 95,
      score: 95
    },
    lineageHead: null
  }
};

const promotionRecord: PolicyPromotionRecord = {
  id: "promotion-1",
  policyHash: "policy-hash-b",
  evaluatedAt: "2024-05-01T10:00:00.000Z",
  reviewer: "reviewer",
  rationale: "Promotion approved with accepted risk.",
  acceptedRisk: 0.55,
  forced: false,
  guardrailDecision,
  createdAt: "2024-05-01T10:05:00.000Z"
};

const rollbackDecision: RollbackDecision = {
  ok: true,
  fromPolicyHash: "policy-hash-b",
  toPolicyHash: "policy-hash-a",
  decisionHash: "rollback-decision-hash",
  reasons: [],
  createdAt: "2024-06-01T12:00:00.000Z"
};

const rollbackEvent: RollbackEvent = {
  eventType: "ROLLBACK",
  eventHash: "rollback-event-hash",
  fromPolicyHash: "policy-hash-b",
  toPolicyHash: "policy-hash-a",
  actor: "sre",
  rationale: "Rollback after incident.",
  createdAt: "2024-06-01T12:00:00.000Z"
};

const counterfactualReport: BlastRadiusReport = {
  policyHash: "policy-hash-b",
  baselinePolicyHash: "policy-hash-a",
  window: { since: "2024-05-01T00:00:00.000Z", until: "2024-06-01T00:00:00.000Z" },
  intentsAffected: 8,
  tracesAffected: 6,
  outcomes: [
    {
      outcomeType: "failure",
      beforeCount: 2,
      afterCount: 4,
      delta: 2,
      severityShift: {
        beforeAvg: 1.5,
        afterAvg: 2.1,
        delta: 0.6
      }
    },
    {
      outcomeType: "override",
      beforeCount: 1,
      afterCount: 1,
      delta: 0
    },
    {
      outcomeType: "rollback",
      beforeCount: 1,
      afterCount: 0,
      delta: -1
    },
    {
      outcomeType: "success",
      beforeCount: 5,
      afterCount: 3,
      delta: -2
    }
  ],
  approvalRateDelta: -0.1,
  rejectionRateDelta: 0.05,
  riskScoreDelta: 0.2,
  reportHash: "counterfactual-report-hash"
};

test("golden decision rationale ledger is stable", () => {
  const decisions = [
    buildDecisionRationale({
      decisionType: "EXECUTION",
      traceId: "trace-a",
      policyHash: "policy-hash-a",
      policyDecision: execDecisionA,
      decisionRecord: execRecordA,
      approvals: [],
      totalRules: 4
    }),
    buildDecisionRationale({
      decisionType: "EXECUTION",
      traceId: "trace-b",
      policyHash: "policy-hash-a",
      policyDecision: execDecisionB,
      decisionRecord: execRecordB,
      approvals: [
        {
          id: "approval-1",
          traceId: "trace-b",
          intentId: "intent-1",
          policyHash: "policy-hash-a",
          decisionId: "decision-b",
          requiredRole: "OPS_REVIEWER",
          actor: "reviewer",
          rationale: "Reviewed manually.",
          approvedAt: new Date("2024-04-02T10:15:00.000Z")
        }
      ],
      totalRules: 6
    }),
    buildDecisionRationale({
      decisionType: "PROMOTION",
      traceId: "trace-promo",
      policyHash: "policy-hash-b",
      promotion: promotionRecord,
      guardrailDecision,
      approval: {
        id: "approval-2",
        policyHash: "policy-hash-b",
        approvedBy: "reviewer",
        approvedAt: "2024-05-01T10:00:00.000Z",
        rationale: "Promotion approved.",
        acceptedRiskScore: 0.55,
        notes: null,
        runId: "run-99",
        createdAt: "2024-05-01T10:01:00.000Z"
      },
      counterfactual: counterfactualReport
    }),
    buildDecisionRationale({
      decisionType: "ROLLBACK",
      traceId: "trace-rollback",
      policyHash: "policy-hash-a",
      decision: rollbackDecision,
      event: rollbackEvent
    }),
    buildDecisionRationale({
      decisionType: "COUNTERFACTUAL",
      traceId: "trace-counter",
      policyHash: "policy-hash-b",
      report: counterfactualReport
    })
  ];

  const expected = JSON.parse(readFileSync(goldenPath, "utf-8")) as unknown;
  expect(decisions).toEqual(expected);
});

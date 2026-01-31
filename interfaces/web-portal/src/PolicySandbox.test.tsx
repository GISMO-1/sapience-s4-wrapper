import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { expect, test, vi } from "vitest";
import { PolicySandbox } from "./PolicySandbox";
import type { ReplayReport, PolicyDriftResponse } from "./api";

vi.mock("./api", () => ({
  runPolicyReplay: vi.fn(),
  fetchReplayReport: vi.fn(),
  fetchTraceExplain: vi.fn(),
  promotePolicy: vi.fn(),
  fetchPolicyLineageCurrent: vi.fn(),
  fetchPolicyQuality: vi.fn(),
  fetchPolicyDrift: vi.fn(),
  recordPolicyOutcome: vi.fn(),
  fetchIntentDecision: vi.fn(),
  approveIntent: vi.fn(),
  executeIntent: vi.fn()
}));

const baseReport: ReplayReport = {
  traceId: "trace-1",
  run: {
    runId: "run-1",
    createdAt: "2024-02-01T10:00:00Z",
    baseline: { hash: "base" },
    candidate: { hash: "cand", source: "current" },
    filters: { limit: 100 }
  },
  totals: {
    count: 1,
    changed: 1,
    unchanged: 0,
    baseline: { allow: 1, warn: 0, deny: 0 },
    candidate: { allow: 0, warn: 0, deny: 1 }
  },
  deltas: { allowDelta: -1, warnDelta: 0, denyDelta: 1 },
  byIntentType: [
    {
      intentType: "CREATE_PO",
      count: 1,
      changed: 1,
      baseline: { allow: 1, warn: 0, deny: 0 },
      candidate: { allow: 0, warn: 0, deny: 1 }
    }
  ],
  topRuleChanges: [],
  topChangedExamples: [],
  impact: {
    score: 5,
    weights: {
      changedDecisions: 1,
      denyToAllowFlips: 5,
      rateLimitViolations: 3,
      highRiskSignals: 2
    },
    counts: {
      changedDecisions: 1,
      denyToAllowFlips: 0,
      rateLimitViolations: 0,
      highRiskSignals: 0
    },
    thresholds: {
      score: 100,
      changedDecisions: 25,
      denyToAllowFlips: 3,
      rateLimitViolations: 5,
      highRiskSignals: 10
    },
    exceeded: [],
    blocked: false
  }
};

const baseQuality = {
  traceId: "trace-1",
  policyHash: "policy-1",
  window: { since: "2024-02-01T00:00:00Z", until: "2024-02-02T00:00:00Z" },
  metrics: {
    totalOutcomes: 2,
    failureRate: 0.5,
    overrideRate: 0,
    weightedPenalty: 6,
    qualityScore: 80
  }
};

const baseDrift: PolicyDriftResponse = {
  traceId: "trace-1",
  report: {
    policyHash: "policy-1",
    recent: {
      window: { since: "2024-02-08T00:00:00Z", until: "2024-02-15T00:00:00Z" },
      metrics: {
        totalOutcomes: 2,
        failureRate: 0.05,
        overrideRate: 0.01,
        qualityScore: 90,
        replayAdded: 2,
        replayRemoved: 1
      }
    },
    baseline: {
      window: { since: "2024-01-09T00:00:00Z", until: "2024-02-08T00:00:00Z" },
      metrics: {
        totalOutcomes: 5,
        failureRate: 0.02,
        overrideRate: 0.01,
        qualityScore: 95,
        replayAdded: 1,
        replayRemoved: 1
      }
    },
    deltas: {
      failureRateDelta: 0.05,
      overrideRateDelta: 0,
      qualityScoreDelta: -5,
      replayDelta: 1
    },
    health: {
      state: "WATCH",
      rationale: ["failureRateDelta >= 0.05 (0.0500)"]
    }
  }
};

test("promotion button remains disabled when impact guardrails block promotion", async () => {
  const { runPolicyReplay, fetchReplayReport, fetchPolicyLineageCurrent, fetchPolicyDrift } = await import("./api");
  vi.mocked(runPolicyReplay).mockResolvedValue({ run: { runId: "run-1" } });
  vi.mocked(fetchReplayReport).mockResolvedValue({
    ...baseReport,
    impact: { ...baseReport.impact, blocked: true }
  });
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);
  const { fetchPolicyQuality } = await import("./api");
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);

  render(<PolicySandbox />);
  fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
  await screen.findByText(/Replay report/i);

  fireEvent.change(screen.getByLabelText(/Approved by/i), { target: { value: "Reviewer" } });
  const rationaleInputs = screen.getAllByLabelText(/Rationale/i);
  fireEvent.change(rationaleInputs[1], { target: { value: "Regression results match baseline." } });
  fireEvent.change(screen.getByLabelText(/Accepted risk score/i), { target: { value: "12" } });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /promote policy/i })).toBeDisabled();
  });
});

test("promotion button enables after approval details when impact is within thresholds", async () => {
  const { runPolicyReplay, fetchReplayReport, fetchPolicyLineageCurrent, fetchPolicyDrift } = await import("./api");
  vi.mocked(runPolicyReplay).mockResolvedValue({ run: { runId: "run-1" } });
  vi.mocked(fetchReplayReport).mockResolvedValue(baseReport);
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);
  const { fetchPolicyQuality } = await import("./api");
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);

  render(<PolicySandbox />);
  fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
  await screen.findByText(/Replay report/i);

  fireEvent.change(screen.getByLabelText(/Approved by/i), { target: { value: "Reviewer" } });
  const rationaleInputs = screen.getAllByLabelText(/Rationale/i);
  fireEvent.change(rationaleInputs[1], { target: { value: "Regression results match baseline." } });
  fireEvent.change(screen.getByLabelText(/Accepted risk score/i), { target: { value: "12" } });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /promote policy/i })).toBeEnabled();
  });
});

test("policy lineage renders without crashing", async () => {
  const { fetchPolicyLineageCurrent, fetchPolicyDrift } = await import("./api");
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: [
      {
        policyHash: "policy-1",
        parentPolicyHash: "policy-0",
        promotedBy: "Reviewer",
        promotedAt: "2024-02-01T10:00:00Z",
        rationale: "Regression results match baseline.",
        acceptedRiskScore: 12,
        source: "replay",
        drift: {
          constraintsAdded: 2,
          constraintsRemoved: 1,
          severityDelta: 1,
          netRiskScoreChange: 1
        }
      }
    ]
  });
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);
  const { fetchPolicyQuality } = await import("./api");
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);

  render(<PolicySandbox />);

  expect(await screen.findByText(/Current policy lineage/i)).toBeInTheDocument();
  const hashes = await screen.findAllByText(/policy-1/);
  expect(hashes.length).toBeGreaterThan(0);
});

test("policy sandbox renders outcome form and submits payload", async () => {
  const { fetchPolicyLineageCurrent, fetchPolicyQuality, fetchPolicyDrift, recordPolicyOutcome } = await import("./api");
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);
  vi.mocked(recordPolicyOutcome).mockResolvedValue({ stored: true });

  render(<PolicySandbox />);

  expect(await screen.findByRole("heading", { name: /Record outcome/i })).toBeInTheDocument();
  const traceInputs = screen.getAllByLabelText(/Trace ID/i);
  fireEvent.change(traceInputs[1], { target: { value: "trace-55" } });
  fireEvent.change(screen.getByLabelText(/Severity/i), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: /record outcome/i }));

  await waitFor(() => {
    expect(recordPolicyOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-55",
        severity: 3
      })
    );
  });
});

test("policy health section renders and calls drift endpoint", async () => {
  const { fetchPolicyLineageCurrent, fetchPolicyQuality, fetchPolicyDrift } = await import("./api");
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);

  render(<PolicySandbox />);

  expect(await screen.findByText(/Policy health/i)).toBeInTheDocument();
  await waitFor(() => {
    expect(fetchPolicyDrift).toHaveBeenCalledWith("policy-1");
  });
});

test("execution gate fetches decision and shows missing approvals", async () => {
  const {
    fetchPolicyLineageCurrent,
    fetchPolicyDrift,
    fetchPolicyQuality,
    fetchIntentDecision,
    approveIntent,
    executeIntent
  } = await import("./api");
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);

  vi.mocked(fetchIntentDecision).mockResolvedValue({
    traceId: "trace-intent",
    intent: {
      intentType: "REVIEW_INVOICE",
      entities: { amount: 75000 },
      confidence: 0.78,
      rawText: "review invoice amount 75000"
    },
    policyHash: "policy-hash",
    decision: {
      outcome: "WARN",
      requiredApprovals: [{ role: "FINANCE_REVIEWER", reason: "Invoice exceeds limit." }],
      reasons: [],
      matchedRuleIds: []
    },
    plan: { intent: "finance.invoice.review", action: "requestInvoiceReview" }
  });

  vi.mocked(approveIntent).mockResolvedValue({
    ok: true,
    approvals: [
      {
        id: "approval-1",
        traceId: "trace-intent",
        intentId: "intent-1",
        policyHash: "policy-hash",
        decisionId: "decision-1",
        requiredRole: "FINANCE_REVIEWER",
        actor: "local-user",
        rationale: "Reviewed",
        approvedAt: "2024-02-01T10:00:00Z"
      }
    ]
  });

  vi.mocked(executeIntent).mockResolvedValue({
    ok: false,
    status: 409,
    data: { missingApprovals: ["FINANCE_REVIEWER"], message: "Missing approvals" }
  });

  render(<PolicySandbox />);

  const traceInputs = screen.getAllByPlaceholderText("trace-id");
  fireEvent.change(traceInputs[0], { target: { value: "trace-intent" } });

  const approveButton = await screen.findByRole("button", { name: /Approve as FINANCE_REVIEWER/i });
  fireEvent.click(approveButton);

  await waitFor(() => {
    expect(approveIntent).toHaveBeenCalled();
  });

  fireEvent.click(screen.getByRole("button", { name: /Execute/i }));

  await screen.findByText(/Missing approvals:/i);
});

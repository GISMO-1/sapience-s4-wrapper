import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { expect, test, vi } from "vitest";
import { PolicySandbox } from "./PolicySandbox";
import type { ReplayReport } from "./api";

vi.mock("./api", () => ({
  runPolicyReplay: vi.fn(),
  fetchReplayReport: vi.fn(),
  fetchTraceExplain: vi.fn(),
  promotePolicy: vi.fn(),
  fetchPolicyLineageCurrent: vi.fn(),
  fetchPolicyQuality: vi.fn(),
  recordPolicyOutcome: vi.fn()
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

test("promotion button remains disabled when impact guardrails block promotion", async () => {
  const { runPolicyReplay, fetchReplayReport, fetchPolicyLineageCurrent } = await import("./api");
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
  const { fetchPolicyQuality } = await import("./api");
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);

  render(<PolicySandbox />);
  fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
  await screen.findByText(/Replay report/i);

  fireEvent.change(screen.getByLabelText(/Approved by/i), { target: { value: "Reviewer" } });
  fireEvent.change(screen.getByLabelText(/Rationale/i), { target: { value: "Regression results match baseline." } });
  fireEvent.change(screen.getByLabelText(/Accepted risk score/i), { target: { value: "12" } });

  expect(screen.getByRole("button", { name: /promote policy/i })).toBeDisabled();
});

test("promotion button enables after approval details when impact is within thresholds", async () => {
  const { runPolicyReplay, fetchReplayReport, fetchPolicyLineageCurrent } = await import("./api");
  vi.mocked(runPolicyReplay).mockResolvedValue({ run: { runId: "run-1" } });
  vi.mocked(fetchReplayReport).mockResolvedValue(baseReport);
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  const { fetchPolicyQuality } = await import("./api");
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);

  render(<PolicySandbox />);
  fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
  await screen.findByText(/Replay report/i);

  fireEvent.change(screen.getByLabelText(/Approved by/i), { target: { value: "Reviewer" } });
  fireEvent.change(screen.getByLabelText(/Rationale/i), { target: { value: "Regression results match baseline." } });
  fireEvent.change(screen.getByLabelText(/Accepted risk score/i), { target: { value: "12" } });

  expect(screen.getByRole("button", { name: /promote policy/i })).toBeEnabled();
});

test("policy lineage renders without crashing", async () => {
  const { fetchPolicyLineageCurrent } = await import("./api");
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
  const { fetchPolicyQuality } = await import("./api");
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);

  render(<PolicySandbox />);

  expect(await screen.findByText(/Current policy lineage/i)).toBeInTheDocument();
  const hashes = await screen.findAllByText(/policy-1/);
  expect(hashes.length).toBeGreaterThan(0);
});

test("policy sandbox renders outcome form and submits payload", async () => {
  const { fetchPolicyLineageCurrent, fetchPolicyQuality, recordPolicyOutcome } = await import("./api");
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);
  vi.mocked(recordPolicyOutcome).mockResolvedValue({ stored: true });

  render(<PolicySandbox />);

  expect(await screen.findByRole("heading", { name: /Record outcome/i })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Trace ID/i), { target: { value: "trace-55" } });
  fireEvent.change(screen.getByLabelText(/Severity/i), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: /record outcome/i }));

  expect(recordPolicyOutcome).toHaveBeenCalledWith(
    expect.objectContaining({
      traceId: "trace-55",
      severity: 3
    })
  );
});

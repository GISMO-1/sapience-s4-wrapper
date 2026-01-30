import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { expect, test, vi } from "vitest";
import { PolicySandbox } from "./PolicySandbox";
import type { ReplayReport } from "./api";

vi.mock("./api", () => ({
  runPolicyReplay: vi.fn(),
  fetchReplayReport: vi.fn(),
  fetchTraceExplain: vi.fn(),
  promotePolicy: vi.fn()
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

test("promotion button remains disabled when impact guardrails block promotion", async () => {
  const { runPolicyReplay, fetchReplayReport } = await import("./api");
  vi.mocked(runPolicyReplay).mockResolvedValue({ run: { runId: "run-1" } });
  vi.mocked(fetchReplayReport).mockResolvedValue({
    ...baseReport,
    impact: { ...baseReport.impact, blocked: true }
  });

  render(<PolicySandbox />);
  fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
  await screen.findByText(/Replay report/i);

  fireEvent.change(screen.getByLabelText(/Approved by/i), { target: { value: "Reviewer" } });
  fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "Regression clean" } });

  expect(screen.getByRole("button", { name: /promote policy/i })).toBeDisabled();
});

test("promotion button enables after approval details when impact is within thresholds", async () => {
  const { runPolicyReplay, fetchReplayReport } = await import("./api");
  vi.mocked(runPolicyReplay).mockResolvedValue({ run: { runId: "run-1" } });
  vi.mocked(fetchReplayReport).mockResolvedValue(baseReport);

  render(<PolicySandbox />);
  fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
  await screen.findByText(/Replay report/i);

  fireEvent.change(screen.getByLabelText(/Approved by/i), { target: { value: "Reviewer" } });
  fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "Regression clean" } });

  expect(screen.getByRole("button", { name: /promote policy/i })).toBeEnabled();
});

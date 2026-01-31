import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, expect, test, vi } from "vitest";
import { PolicySandbox } from "./PolicySandbox";
import type {
  ReplayReport,
  PolicyDriftResponse,
  PolicyImpactSimulationReport,
  PromotionGuardrailDecision,
  PolicyLifecycleTimeline,
  PolicyVerificationResponse
} from "./api";

vi.mock("./api", () => ({
  runPolicyReplay: vi.fn(),
  fetchReplayReport: vi.fn(),
  fetchTraceExplain: vi.fn(),
  promotePolicy: vi.fn(),
  fetchPolicyLineageCurrent: vi.fn(),
  fetchPolicyQuality: vi.fn(),
  fetchPolicyDrift: vi.fn(),
  recordPolicyOutcome: vi.fn(),
  fetchPolicyImpactReport: vi.fn(),
  fetchIntentDecision: vi.fn(),
  approveIntent: vi.fn(),
  executeIntent: vi.fn(),
  fetchPromotionCheck: vi.fn(),
  fetchPolicyTimeline: vi.fn(),
  fetchPolicyVerify: vi.fn()
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

const baseVerification: PolicyVerificationResponse = {
  traceId: "trace-1",
  policyHash: "policy-1",
  verified: false,
  mismatches: [
    {
      field: "quality",
      expected: { qualityScore: 90 },
      actual: { qualityScore: 80 }
    }
  ],
  eventCount: 4,
  lastEventHash: "event-hash-1",
  windows: {
    drift: {
      recent: { since: "2024-02-08T00:00:00Z", until: "2024-02-15T00:00:00Z" },
      baseline: { since: "2024-01-09T00:00:00Z", until: "2024-02-08T00:00:00Z" }
    },
    quality: null
  }
};

const baseImpactReport: PolicyImpactSimulationReport = {
  traceId: "trace-1",
  policyHashCurrent: "policy-current",
  policyHashCandidate: "policy-candidate",
  window: { since: "2024-02-01T00:00:00Z", until: "2024-02-02T00:00:00Z" },
  totals: {
    intentsEvaluated: 2,
    newlyBlocked: 1,
    newlyAllowed: 0,
    approvalEscalations: 1,
    severityIncreases: 1
  },
  blastRadiusScore: 10,
  rows: [
    {
      intentId: "trace-1",
      traceId: "trace-1",
      intentType: "CREATE_PO",
      prevDecision: "WARN",
      nextDecision: "DENY",
      prevApprovalsRequired: ["FINANCE_REVIEWER"],
      nextApprovalsRequired: ["FINANCE_REVIEWER", "COMPLIANCE_REVIEWER"],
      prevSeverity: 1,
      nextSeverity: 2,
      classifications: ["NEWLY_BLOCKED", "APPROVAL_ESCALATED", "SEVERITY_INCREASED"]
    }
  ]
};

const baseGuardrailDecision: PromotionGuardrailDecision = {
  allowed: false,
  requiredAcceptance: true,
  reasons: [
    {
      code: "BLAST_RADIUS_EXCEEDED",
      message: "Blast radius exceeds guardrails.",
      metric: 15,
      threshold: 10
    }
  ],
  snapshot: {
    policyHash: "policy-1",
    evaluatedAt: "2024-02-02T10:00:00Z",
    drift: baseDrift.report,
    impact: { ...baseImpactReport, impactedIntents: 1 },
    quality: {
      totalOutcomes: 2,
      failureRate: 0.1,
      overrideRate: 0.01,
      weightedPenalty: 2,
      qualityScore: 98,
      score: 2
    },
    lineageHead: null
  }
};

const baseTimeline: PolicyLifecycleTimeline = {
  state: "ACTIVE",
  events: [
    {
      type: "simulation",
      timestamp: "2024-02-01T10:00:00Z",
      actor: "analyst",
      rationale: "Replay run run-1"
    },
    {
      type: "promotion",
      timestamp: "2024-02-01T12:00:00Z",
      actor: "Reviewer",
      rationale: "Regression results match baseline."
    }
  ]
};

beforeEach(async () => {
  const { fetchPolicyTimeline } = await import("./api");
  vi.mocked(fetchPolicyTimeline).mockResolvedValue(baseTimeline);
});

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
  fireEvent.click(await screen.findByRole("button", { name: /run replay/i }));
  await screen.findByText(/Replay report/i);

  fireEvent.change(screen.getByLabelText(/Approved by/i), { target: { value: "Reviewer" } });
  fireEvent.change(screen.getByPlaceholderText(/Explain why the promotion is acceptable/i), {
    target: { value: "Regression results match baseline." }
  });
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
  fireEvent.click(await screen.findByRole("button", { name: /run replay/i }));
  await screen.findByText(/Replay report/i);

  fireEvent.change(screen.getByLabelText(/Approved by/i), { target: { value: "Reviewer" } });
  fireEvent.change(screen.getByPlaceholderText(/Explain why the promotion is acceptable/i), {
    target: { value: "Regression results match baseline." }
  });
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

test("determinism panel verifies and shows first mismatch", async () => {
  const { fetchPolicyLineageCurrent, fetchPolicyQuality, fetchPolicyDrift, fetchPolicyVerify } = await import("./api");
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);
  vi.mocked(fetchPolicyVerify).mockResolvedValue(baseVerification);

  render(<PolicySandbox />);

  const policyHashInput = await screen.findByLabelText(/Policy hash/i);
  fireEvent.change(policyHashInput, { target: { value: "policy-1" } });

  fireEvent.click(screen.getByRole("button", { name: /verify/i }));

  await waitFor(() => {
    expect(fetchPolicyVerify).toHaveBeenCalledWith(expect.objectContaining({ policyHash: "policy-1" }));
  });

  expect(await screen.findByText(/INCONSISTENT/i)).toBeInTheDocument();
  expect(screen.getByText(/First mismatch/i)).toBeInTheDocument();
});

test("policy impact simulation renders blast radius summary", async () => {
  const { fetchPolicyLineageCurrent, fetchPolicyQuality, fetchPolicyDrift, fetchPolicyImpactReport } =
    await import("./api");
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);
  vi.mocked(fetchPolicyImpactReport).mockResolvedValue(baseImpactReport);

  render(<PolicySandbox />);

  const impactHeading = await screen.findByRole("heading", { name: /Policy Impact Simulation/i });
  const impactCard = impactHeading.closest(".sandbox-card");
  if (!impactCard) {
    throw new Error("Impact card not found");
  }
  const impactScope = within(impactCard);

  fireEvent.change(await impactScope.findByLabelText(/Candidate policy/i), {
    target: { value: "version: \"v1\"\n" }
  });
  fireEvent.change(await impactScope.findByLabelText(/Since/i), {
    target: { value: "2024-02-01T00:00" }
  });
  fireEvent.change(await impactScope.findByLabelText(/Until/i), {
    target: { value: "2024-02-02T00:00" }
  });

  fireEvent.click(await impactScope.findByRole("button", { name: /Run simulation/i }));

  await waitFor(() => {
    expect(fetchPolicyImpactReport).toHaveBeenCalledWith(
      expect.objectContaining({
        candidatePolicy: "version: \"v1\"\n"
      })
    );
  });

  expect(await screen.findByText(/Blast radius/i)).toBeInTheDocument();
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByText(/NEWLY_BLOCKED/)).toBeInTheDocument();
});

test("promotion guardrail check renders reasons", async () => {
  const { fetchPolicyLineageCurrent, fetchPolicyDrift, fetchPolicyQuality, fetchPromotionCheck } =
    await import("./api");
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);
  vi.mocked(fetchPromotionCheck).mockResolvedValue({ traceId: "trace-1", ...baseGuardrailDecision });

  render(<PolicySandbox />);

  const policyEntries = await screen.findAllByText("policy-1");
  expect(policyEntries.length).toBeGreaterThan(0);
  fireEvent.click(await screen.findByRole("button", { name: /Check Promotion/i }));

  await waitFor(() => {
    expect(fetchPromotionCheck).toHaveBeenCalledWith("policy-1");
  });

  expect(await screen.findByText(/BLAST_RADIUS_EXCEEDED/i)).toBeInTheDocument();
});

test("blocked promotion requires force checkbox to enable promotion", async () => {
  const { fetchPolicyLineageCurrent, fetchPolicyDrift, fetchPolicyQuality, fetchPromotionCheck } =
    await import("./api");
  vi.mocked(fetchPolicyLineageCurrent).mockResolvedValue({
    traceId: "trace-1",
    policyHash: "policy-1",
    lineage: []
  });
  vi.mocked(fetchPolicyDrift).mockResolvedValue(baseDrift);
  vi.mocked(fetchPolicyQuality).mockResolvedValue(baseQuality);
  vi.mocked(fetchPromotionCheck).mockResolvedValue({ traceId: "trace-1", ...baseGuardrailDecision });

  render(<PolicySandbox />);

  const policyEntries = await screen.findAllByText("policy-1");
  expect(policyEntries.length).toBeGreaterThan(0);
  fireEvent.click(await screen.findByRole("button", { name: /Check Promotion/i }));
  await screen.findByText(/BLAST_RADIUS_EXCEEDED/i);

  fireEvent.change(screen.getByLabelText(/Reviewer/i), { target: { value: "Reviewer" } });
  fireEvent.change(screen.getByPlaceholderText(/Explain promotion acceptance/i), {
    target: { value: "Guardrail override accepted for limited blast radius." }
  });
  fireEvent.change(screen.getByLabelText(/Accepted risk/i), { target: { value: "10" } });

  const promoteButton = screen.getByRole("button", { name: /^Promote$/i });
  expect(promoteButton).toBeDisabled();

  fireEvent.click(screen.getByLabelText(/Force promote/i));
  await waitFor(() => {
    expect(promoteButton).toBeEnabled();
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

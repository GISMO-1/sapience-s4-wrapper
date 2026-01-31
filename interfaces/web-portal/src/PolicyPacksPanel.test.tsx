import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, expect, test, vi } from "vitest";
import { PolicyPacksPanel } from "./PolicyPacksPanel";
import type { PolicyPackInstallBundle, PolicyPackSummary, PolicyPackDetails } from "./api";

const packs: PolicyPackSummary[] = [
  {
    name: "sample-pack",
    version: "1.0.0",
    description: "Sample pack",
    createdAt: "2024-04-01T00:00:00Z",
    author: "Sapience",
    policyHash: "policy-hash",
    packHash: "pack-hash",
    signed: false
  }
];

const packDetails: PolicyPackDetails = {
  ...packs[0],
  policy: { version: "v1" },
  notes: "Pack notes"
};

const installBundle: PolicyPackInstallBundle = {
  pack: packs[0],
  candidate: { policyHash: "candidate-hash", source: "path", ref: "policies/packs/sample-pack/policy.yaml" },
  hashes: { policyHash: "policy-hash", packHash: "pack-hash", candidatePolicyHash: "candidate-hash" },
  reports: {
    impact: {
      traceId: "trace-1",
      policyHashCurrent: "policy-current",
      policyHashCandidate: "policy-candidate",
      window: { since: "2024-04-01T00:00:00Z", until: "2024-04-02T00:00:00Z" },
      totals: {
        intentsEvaluated: 1,
        newlyBlocked: 1,
        newlyAllowed: 0,
        approvalEscalations: 0,
        severityIncreases: 1
      },
      blastRadiusScore: 5,
      rows: [
        {
          intentId: "trace-1",
          traceId: "trace-1",
          intentType: "CREATE_PO",
          prevDecision: "WARN",
          nextDecision: "DENY",
          prevApprovalsRequired: [],
          nextApprovalsRequired: [],
          prevSeverity: 1,
          nextSeverity: 2,
          classifications: ["NEWLY_BLOCKED"]
        }
      ]
    },
    drift: {
      policyHash: "policy-candidate",
      recent: {
        window: { since: "2024-03-01T00:00:00Z", until: "2024-03-08T00:00:00Z" },
        metrics: {
          totalOutcomes: 0,
          failureRate: 0,
          overrideRate: 0,
          qualityScore: 0,
          replayAdded: 0,
          replayRemoved: 0
        }
      },
      baseline: {
        window: { since: "2024-02-01T00:00:00Z", until: "2024-03-01T00:00:00Z" },
        metrics: {
          totalOutcomes: 0,
          failureRate: 0,
          overrideRate: 0,
          qualityScore: 0,
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
    guardrail: {
      allowed: true,
      requiredAcceptance: false,
      reasons: [],
      snapshot: {
        policyHash: "policy-candidate",
        evaluatedAt: "2024-04-01T00:00:00Z",
        drift: {
          policyHash: "policy-candidate",
          recent: {
            window: { since: "2024-03-01T00:00:00Z", until: "2024-03-08T00:00:00Z" },
            metrics: {
              totalOutcomes: 0,
              failureRate: 0,
              overrideRate: 0,
              qualityScore: 0,
              replayAdded: 0,
              replayRemoved: 0
            }
          },
          baseline: {
            window: { since: "2024-02-01T00:00:00Z", until: "2024-03-01T00:00:00Z" },
            metrics: {
              totalOutcomes: 0,
              failureRate: 0,
              overrideRate: 0,
              qualityScore: 0,
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
          traceId: "trace-1",
          policyHashCurrent: "policy-current",
          policyHashCandidate: "policy-candidate",
          window: { since: "2024-04-01T00:00:00Z", until: "2024-04-02T00:00:00Z" },
          totals: {
            intentsEvaluated: 1,
            newlyBlocked: 1,
            newlyAllowed: 0,
            approvalEscalations: 0,
            severityIncreases: 1
          },
          blastRadiusScore: 5,
          rows: [],
          impactedIntents: 1
        },
        quality: {
          totalOutcomes: 0,
          failureRate: 0,
          overrideRate: 0,
          weightedPenalty: 0,
          qualityScore: 0,
          score: 100
        },
        lineageHead: null
      }
    }
  }
};

vi.mock("./api", () => ({
  fetchPolicyPacks: vi.fn(() => Promise.resolve({ traceId: "trace-1", packs })),
  fetchPolicyPack: vi.fn(() => Promise.resolve({ traceId: "trace-1", pack: packDetails })),
  installPolicyPack: vi.fn(() => Promise.resolve({ traceId: "trace-1", bundle: installBundle }))
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("renders policy packs and install flow", async () => {
  render(<PolicyPacksPanel />);
  await waitFor(() => {
    expect(screen.getByText("sample-pack")).toBeInTheDocument();
  });

  fireEvent.click(screen.getByText("sample-pack"));
  await waitFor(() => {
    expect(screen.getByText("Sample pack")).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole("button", { name: /Install as candidate/i }));
  await waitFor(() => {
    expect(screen.getByText(/Installation results/i)).toBeInTheDocument();
  });
  expect(screen.getByText(/Impact summary/i)).toBeInTheDocument();
  expect(screen.getByText(/Blast radius details/i)).toBeInTheDocument();
});

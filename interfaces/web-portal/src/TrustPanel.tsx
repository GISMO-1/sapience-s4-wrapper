import { useEffect, useState } from "react";
import { fetchTrustReport, type TrustReport } from "./api";

const FALLBACK_REPORT: TrustReport = {
  policyHash: "unknown",
  generatedAt: "",
  healthState: "HEALTHY",
  lastDecisionSummary: {
    decisionType: "EXECUTION",
    outcome: "FAIL",
    confidenceScore: 0,
    acceptedRisk: {
      severity: "LOW",
      justification: "No decision data available.",
      reviewer: null,
      score: null
    }
  },
  driftSummary: {
    window: { since: "", until: "" },
    deltaCounts: {
      failureRateDelta: 0,
      overrideRateDelta: 0,
      qualityScoreDelta: 0,
      replayDelta: 0
    },
    severity: "HEALTHY"
  },
  determinismStatus: {
    reproducible: false,
    lastVerifiedAt: ""
  },
  rollbackStatus: {
    lastRollbackAt: null,
    reconciled: true
  },
  counterfactualSummary: {
    alternativesEvaluated: 0,
    maxDeltaSeverity: 0
  },
  provenanceHash: "",
  overallTrustScore: 0
};

export function TrustPanel() {
  const [report, setReport] = useState<TrustReport>(FALLBACK_REPORT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetchTrustReport();
        if (!active) {
          return;
        }
        setReport(response.report);
        setError(null);
      } catch (fetchError) {
        if (!active) {
          return;
        }
        setError((fetchError as Error).message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const decisionSummary = `Last decision: ${report.lastDecisionSummary.decisionType} ${
    report.lastDecisionSummary.outcome
  } with ${(report.lastDecisionSummary.confidenceScore * 100).toFixed(0)}% confidence.`;

  const driftWarning =
    report.driftSummary.severity === "HEALTHY"
      ? null
      : `Drift warning: ${report.driftSummary.severity} (${report.driftSummary.deltaCounts.replayDelta} replay deltas).`;

  return (
    <section className="trust-panel">
      <div className="panel-header">
        <div>
          <h2>System Trust</h2>
          <p className="panel-subtitle">Deterministic snapshot of the active policy health.</p>
        </div>
        <div className={`trust-score ${report.healthState.toLowerCase()}`}>
          {report.overallTrustScore.toFixed(0)}
        </div>
      </div>
      {loading ? <p>Loading trust report...</p> : null}
      {error ? <p className="panel-error">Unable to load trust report: {error}</p> : null}
      <div className="trust-grid">
        <div>
          <h3>Health</h3>
          <p>{report.healthState}</p>
        </div>
        <div>
          <h3>Determinism</h3>
          <p>
            {report.determinismStatus.reproducible ? "✓ Reproducible" : "✕ Not reproducible"}
            {report.determinismStatus.lastVerifiedAt
              ? ` (verified ${report.determinismStatus.lastVerifiedAt})`
              : ""}
          </p>
        </div>
        <div>
          <h3>Rollback</h3>
          <p>
            {report.rollbackStatus.lastRollbackAt
              ? `Last rollback ${report.rollbackStatus.lastRollbackAt}`
              : "No rollback recorded"}
            {report.rollbackStatus.lastRollbackAt ? ` · ${report.rollbackStatus.reconciled ? "Reconciled" : "Pending"}` : ""}
          </p>
        </div>
      </div>
      <p className="trust-summary">{decisionSummary}</p>
      {driftWarning ? <p className="trust-warning">{driftWarning}</p> : null}
    </section>
  );
}

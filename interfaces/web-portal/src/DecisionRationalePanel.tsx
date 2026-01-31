import { useMemo, useState } from "react";
import type { DecisionRationale } from "./api";
import { fetchDecisionRationale, fetchDecisionsByTraceId } from "./api";

const apiBase = import.meta.env.VITE_API_BASE ?? "";

function buildApiUrl(path: string) {
  if (!apiBase) {
    return path;
  }
  return `${apiBase.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function formatPercent(score: number) {
  const clamped = Math.min(1, Math.max(0, score));
  return `${(clamped * 100).toFixed(1)}%`;
}

export function DecisionRationalePanel() {
  const [traceId, setTraceId] = useState("");
  const [decisionId, setDecisionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<DecisionRationale[]>([]);

  const counterfactualLink = useMemo(() => {
    const policyHash = decisions[0]?.policyHash;
    if (!policyHash) {
      return null;
    }
    return buildApiUrl(`/v1/policy/blast-radius?policyHash=${encodeURIComponent(policyHash)}`);
  }, [decisions]);

  const handleFetch = async () => {
    const trimmedDecisionId = decisionId.trim();
    const trimmedTraceId = traceId.trim();
    if (!trimmedDecisionId && !trimmedTraceId) {
      setError("Enter a decision ID or trace ID.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (trimmedDecisionId) {
        const result = await fetchDecisionRationale(trimmedDecisionId);
        setDecisions([result.rationale]);
      } else {
        const result = await fetchDecisionsByTraceId(trimmedTraceId);
        setDecisions(result.decisions);
      }
    } catch (err) {
      setError((err as Error).message);
      setDecisions([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <h2>Decision Rationale</h2>
      <p>Lookup a decision rationale by trace ID or decision ID.</p>
      <div className="decision-rationale-controls">
        <input
          type="text"
          value={traceId}
          onChange={(event) => setTraceId(event.target.value)}
          placeholder="Trace ID"
        />
        <input
          type="text"
          value={decisionId}
          onChange={(event) => setDecisionId(event.target.value)}
          placeholder="Decision ID"
        />
        <button type="button" onClick={handleFetch} disabled={loading}>
          {loading ? "Loading..." : "Fetch"}
        </button>
      </div>
      {error ? <p className="panel-error">{error}</p> : null}
      {decisions.length === 0 ? (
        <p className="panel-empty">No decisions loaded yet.</p>
      ) : (
        <div className="decision-rationale-list">
          {decisions.map((decision) => (
            <article key={decision.decisionId} className="decision-rationale-card">
              <header>
                <div>
                  <strong>{decision.decisionType}</strong> · {decision.outcome}
                </div>
                <div className="decision-rationale-meta">ID: {decision.decisionId}</div>
              </header>
              <div className="decision-rationale-meta">
                Policy {decision.policyHash} · Trace {decision.traceId}
              </div>
              <div className="confidence-bar">
                <div className="confidence-bar-track">
                  <div
                    className="confidence-bar-fill"
                    style={{ width: formatPercent(decision.confidenceScore) }}
                  />
                </div>
                <span>{formatPercent(decision.confidenceScore)}</span>
              </div>
              <div>
                <h3>Rationale</h3>
                {decision.rationaleBlocks.length === 0 ? (
                  <p>No rationale blocks recorded.</p>
                ) : (
                  <ul>
                    {decision.rationaleBlocks.map((block) => (
                      <li key={`${decision.decisionId}-${block.type}`}>
                        <strong>{block.summary}</strong>
                        <ul>
                          {block.entries.map((entry, index) => (
                            <li key={`${decision.decisionId}-${block.type}-${index}`}>{entry}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3>Accepted Risk</h3>
                <p>
                  {decision.acceptedRisk.severity} · {decision.acceptedRisk.justification}
                </p>
                {decision.acceptedRisk.reviewer ? (
                  <p>Reviewer: {decision.acceptedRisk.reviewer}</p>
                ) : null}
              </div>
              <div>
                <h3>Rejected Alternatives</h3>
                {decision.rejectedAlternatives.length === 0 ? (
                  <p>No rejected alternatives recorded.</p>
                ) : (
                  <ul>
                    {decision.rejectedAlternatives.map((alternative) => (
                      <li key={`${decision.decisionId}-${alternative.label}`}>
                        {alternative.label} · Δ {alternative.delta}
                        {alternative.details ? ` (${alternative.details})` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {counterfactualLink ? (
                  <a href={counterfactualLink} target="_blank" rel="noreferrer">
                    View counterfactual details
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

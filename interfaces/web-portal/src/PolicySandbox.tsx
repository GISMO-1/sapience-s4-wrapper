import { useEffect, useState } from "react";
import {
  fetchReplayReport,
  fetchTraceExplain,
  fetchPolicyLineageCurrent,
  fetchPolicyQuality,
  recordPolicyOutcome,
  promotePolicy,
  runPolicyReplay,
  type PolicyOutcomeType,
  type PolicyQualityResponse,
  type PolicyLineageResponse,
  type ReplayCandidateSource,
  type ReplayReport
} from "./api";

const DEFAULT_INLINE = "version: \"v1\"\n";

export function PolicySandbox() {
  const [candidateSource, setCandidateSource] = useState<ReplayCandidateSource>("current");
  const [candidatePath, setCandidatePath] = useState("policies.v1.yaml");
  const [inlineYaml, setInlineYaml] = useState(DEFAULT_INLINE);
  const [limit, setLimit] = useState("100");
  const [intentTypes, setIntentTypes] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReplayReport | null>(null);
  const [traceExplain, setTraceExplain] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [approver, setApprover] = useState("");
  const [approvalRationale, setApprovalRationale] = useState("");
  const [acceptedRiskScore, setAcceptedRiskScore] = useState("");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [promotionStatus, setPromotionStatus] = useState<string>("");
  const [promotionError, setPromotionError] = useState<string>("");
  const [promotionLoading, setPromotionLoading] = useState(false);
  const [lineage, setLineage] = useState<PolicyLineageResponse | null>(null);
  const [lineageError, setLineageError] = useState<string>("");
  const [outcomeTraceId, setOutcomeTraceId] = useState("");
  const [outcomeType, setOutcomeType] = useState<PolicyOutcomeType>("success");
  const [outcomeSeverity, setOutcomeSeverity] = useState("1");
  const [outcomeHumanOverride, setOutcomeHumanOverride] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [outcomeStatus, setOutcomeStatus] = useState("");
  const [outcomeError, setOutcomeError] = useState("");
  const [policyQuality, setPolicyQuality] = useState<PolicyQualityResponse | null>(null);
  const [policyQualityError, setPolicyQualityError] = useState("");
  const [policyQualityLoading, setPolicyQualityLoading] = useState(false);

  useEffect(() => {
    const loadLineage = async () => {
      setLineageError("");
      try {
        const response = await fetchPolicyLineageCurrent();
        setLineage(response);
      } catch (err) {
        setLineageError((err as Error).message);
      }
    };
    loadLineage();
  }, []);

  useEffect(() => {
    const loadQuality = async () => {
      if (!lineage?.policyHash) {
        return;
      }
      setPolicyQualityLoading(true);
      setPolicyQualityError("");
      try {
        const response = await fetchPolicyQuality(lineage.policyHash);
        setPolicyQuality(response);
      } catch (err) {
        setPolicyQualityError((err as Error).message);
      } finally {
        setPolicyQualityLoading(false);
      }
    };
    void loadQuality();
  }, [lineage?.policyHash]);

  const buildFilters = () => {
    const parsedLimit = Number(limit);
    const parsedIntentTypes = intentTypes
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      intentTypes: parsedIntentTypes.length ? parsedIntentTypes : undefined
    };
  };

  const buildCandidate = () => {
    if (candidateSource === "path") {
      return { source: "path" as const, ref: candidatePath.trim() };
    }
    if (candidateSource === "inline") {
      return { source: "inline" as const, yaml: inlineYaml };
    }
    return { source: "current" as const };
  };

  const handleReplay = async () => {
    setLoading(true);
    setError("");
    setReport(null);
    setTraceExplain("");
    setPromotionStatus("");
    setPromotionError("");
    try {
      const response = await runPolicyReplay({ candidatePolicy: buildCandidate(), filters: buildFilters() });
      const runId = response?.run?.runId;
      if (!runId) {
        throw new Error("Replay run did not return a runId");
      }
      const reportResponse = await fetchReplayReport(runId);
      setReport(reportResponse);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handlePromote = async () => {
    if (!report) {
      return;
    }
    setPromotionLoading(true);
    setPromotionError("");
    setPromotionStatus("");
    try {
      await promotePolicy({
        runId: report.run.runId,
        approvedBy: approver.trim(),
        rationale: approvalRationale.trim(),
        acceptedRiskScore: Number(acceptedRiskScore),
        reason: approvalRationale.trim(),
        notes: approvalNotes.trim() || undefined
      });
      setPromotionStatus("Policy promoted successfully.");
      try {
        const response = await fetchPolicyLineageCurrent();
        setLineage(response);
      } catch (err) {
        setLineageError((err as Error).message);
      }
    } catch (err) {
      setPromotionError((err as Error).message);
    } finally {
      setPromotionLoading(false);
    }
  };

  const handleTraceExplain = async (traceId: string) => {
    try {
      const response = await fetchTraceExplain(traceId);
      setTraceExplain(JSON.stringify(response, null, 2));
    } catch (err) {
      setTraceExplain(JSON.stringify({ error: (err as Error).message }, null, 2));
    }
  };

  const handleOutcomeSubmit = async () => {
    setOutcomeStatus("");
    setOutcomeError("");
    try {
      await recordPolicyOutcome({
        traceId: outcomeTraceId.trim(),
        outcomeType,
        severity: Number(outcomeSeverity),
        humanOverride: outcomeHumanOverride,
        notes: outcomeNotes.trim() || undefined
      });
      setOutcomeStatus("Outcome recorded.");
      setOutcomeTraceId("");
      setOutcomeNotes("");
      if (lineage?.policyHash) {
        try {
          const response = await fetchPolicyQuality(lineage.policyHash);
          setPolicyQuality(response);
        } catch (err) {
          setPolicyQualityError((err as Error).message);
        }
      }
    } catch (err) {
      setOutcomeError((err as Error).message);
    }
  };

  const severityValue = Number(outcomeSeverity);
  const severityValid = Number.isFinite(severityValue) && severityValue >= 1 && severityValue <= 5;

  return (
    <section className="policy-sandbox">
      <h2>Policy Sandbox</h2>
      <p>Run policy replay against historical intents and inspect impact summaries.</p>
      <div className="sandbox-card">
        <div className="sandbox-section">
          <h3>Candidate policy</h3>
          <div className="sandbox-row">
            <label>
              <input
                type="radio"
                name="candidate"
                value="current"
                checked={candidateSource === "current"}
                onChange={() => setCandidateSource("current")}
              />
              Current
            </label>
            <label>
              <input
                type="radio"
                name="candidate"
                value="path"
                checked={candidateSource === "path"}
                onChange={() => setCandidateSource("path")}
              />
              Path
            </label>
            <label>
              <input
                type="radio"
                name="candidate"
                value="inline"
                checked={candidateSource === "inline"}
                onChange={() => setCandidateSource("inline")}
              />
              Inline
            </label>
          </div>
          {candidateSource === "path" && (
            <div className="sandbox-row">
              <input
                type="text"
                value={candidatePath}
                list="policy-paths"
                onChange={(event) => setCandidatePath(event.target.value)}
              />
              <datalist id="policy-paths">
                <option value="policies.v1.yaml" />
              </datalist>
            </div>
          )}
          {candidateSource === "inline" && (
            <div className="sandbox-row sandbox-inline">
              <textarea value={inlineYaml} onChange={(event) => setInlineYaml(event.target.value)} rows={6} />
              <small>Requires POLICY_INLINE_ENABLED=true on the gateway.</small>
            </div>
          )}
        </div>
        <div className="sandbox-section">
          <h3>Filters</h3>
          <div className="sandbox-row">
            <label>
              Limit
              <input type="number" min={1} value={limit} onChange={(event) => setLimit(event.target.value)} />
            </label>
            <label>
              Intent types (comma-separated)
              <input
                type="text"
                value={intentTypes}
                onChange={(event) => setIntentTypes(event.target.value)}
                placeholder="CREATE_PO,CHECK_INVENTORY"
              />
            </label>
          </div>
        </div>
        <div className="sandbox-actions">
          <button type="button" onClick={handleReplay} disabled={loading}>
            {loading ? "Running..." : "Run Replay"}
          </button>
          {error && <span className="sandbox-error">{error}</span>}
        </div>
      </div>

      <div className="sandbox-card">
        <h3>Current policy lineage</h3>
        {lineageError && <span className="sandbox-error">{lineageError}</span>}
        {!lineage && !lineageError && <span>Loading lineage...</span>}
        {lineage && (
          <>
            <div className="sandbox-row">
              <strong>Active policy hash:</strong> <span>{lineage.policyHash}</span>
            </div>
            <table className="sandbox-table">
              <thead>
                <tr>
                  <th>Policy hash</th>
                  <th>Parent</th>
                  <th>Promoted by</th>
                  <th>Promoted at</th>
                  <th>Rationale</th>
                  <th>Accepted risk</th>
                  <th>Drift (added/removed)</th>
                  <th>Severity Δ</th>
                  <th>Risk score Δ</th>
                </tr>
              </thead>
              <tbody>
                {lineage.lineage.map((entry) => (
                  <tr key={entry.policyHash}>
                    <td>{entry.policyHash}</td>
                    <td>{entry.parentPolicyHash ?? "root"}</td>
                    <td>{entry.promotedBy}</td>
                    <td>{new Date(entry.promotedAt).toLocaleString()}</td>
                    <td>{entry.rationale}</td>
                    <td>{entry.acceptedRiskScore}</td>
                    <td>
                      +{entry.drift.constraintsAdded}/-{entry.drift.constraintsRemoved}
                    </td>
                    <td>{entry.drift.severityDelta}</td>
                    <td>{entry.drift.netRiskScoreChange}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Policy quality</h3>
        {policyQualityLoading && <span>Loading quality metrics...</span>}
        {policyQualityError && <span className="sandbox-error">{policyQualityError}</span>}
        {!policyQualityLoading && !policyQuality && !policyQualityError && (
          <span>Load an active policy to see outcome quality.</span>
        )}
        {policyQuality && (
          <div className="report-grid">
            <div>
              <strong>Policy hash</strong>
              <div>{policyQuality.policyHash}</div>
            </div>
            <div>
              <strong>Total outcomes</strong>
              <div>{policyQuality.metrics.totalOutcomes}</div>
            </div>
            <div>
              <strong>Failure rate</strong>
              <div>{(policyQuality.metrics.failureRate * 100).toFixed(1)}%</div>
            </div>
            <div>
              <strong>Override rate</strong>
              <div>{(policyQuality.metrics.overrideRate * 100).toFixed(1)}%</div>
            </div>
            <div>
              <strong>Quality score</strong>
              <div>{policyQuality.metrics.qualityScore.toFixed(1)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="sandbox-card">
        <h3>Record outcome</h3>
        <div className="sandbox-row">
          <label>
            Trace ID
            <input
              type="text"
              value={outcomeTraceId}
              onChange={(event) => setOutcomeTraceId(event.target.value)}
              placeholder="trace-id"
            />
          </label>
          <label>
            Outcome type
            <select value={outcomeType} onChange={(event) => setOutcomeType(event.target.value as PolicyOutcomeType)}>
              <option value="success">success</option>
              <option value="failure">failure</option>
              <option value="override">override</option>
              <option value="rollback">rollback</option>
            </select>
          </label>
          <label>
            Severity (1-5)
            <input
              type="number"
              min={1}
              max={5}
              value={outcomeSeverity}
              onChange={(event) => setOutcomeSeverity(event.target.value)}
            />
          </label>
          <label>
            Human override
            <input
              type="checkbox"
              checked={outcomeHumanOverride}
              onChange={(event) => setOutcomeHumanOverride(event.target.checked)}
            />
          </label>
        </div>
        <div className="sandbox-row">
          <label className="sandbox-notes">
            Notes
            <textarea
              value={outcomeNotes}
              onChange={(event) => setOutcomeNotes(event.target.value)}
              rows={3}
              placeholder="Optional context for the outcome"
            />
          </label>
        </div>
        <div className="sandbox-actions">
          <button
            type="button"
            onClick={handleOutcomeSubmit}
            disabled={!outcomeTraceId.trim() || !severityValid}
          >
            Record outcome
          </button>
          {outcomeStatus && <span className="sandbox-success">{outcomeStatus}</span>}
          {outcomeError && <span className="sandbox-error">{outcomeError}</span>}
        </div>
      </div>

      {report && (
        <div className="sandbox-report">
          <h3>Replay report</h3>
          <div className="report-grid">
            <div>
              <strong>Run</strong>
              <div>Run ID: {report.run.runId}</div>
              <div>Created: {new Date(report.run.createdAt).toLocaleString()}</div>
            </div>
            <div>
              <strong>Totals</strong>
              <div>Count: {report.totals.count}</div>
              <div>Changed: {report.totals.changed}</div>
              <div>Unchanged: {report.totals.unchanged}</div>
            </div>
            <div>
              <strong>Deltas</strong>
              <div>Allow: {report.deltas.allowDelta}</div>
              <div>Warn: {report.deltas.warnDelta}</div>
              <div>Deny: {report.deltas.denyDelta}</div>
            </div>
            <div>
              <strong>Impact</strong>
              <div>Score: {report.impact.score}</div>
              <div>Changed decisions: {report.impact.counts.changedDecisions}</div>
              <div>Deny → Allow flips: {report.impact.counts.denyToAllowFlips}</div>
              <div>Rate-limit hits: {report.impact.counts.rateLimitViolations}</div>
              <div>High-risk signals: {report.impact.counts.highRiskSignals}</div>
              <div className={report.impact.blocked ? "impact-blocked" : "impact-ok"}>
                {report.impact.blocked ? "Promotion blocked" : "Promotion eligible"}
              </div>
            </div>
          </div>

          <div className="sandbox-card sandbox-approval">
            <h4>Promotion approval</h4>
            <div className="sandbox-row">
              <label>
                Approved by
                <input
                  type="text"
                  value={approver}
                  onChange={(event) => setApprover(event.target.value)}
                  placeholder="Analyst name"
                />
              </label>
              <label>
                Rationale
                <input
                  type="text"
                  value={approvalRationale}
                  onChange={(event) => setApprovalRationale(event.target.value)}
                  placeholder="Explain why the promotion is acceptable"
                />
              </label>
              <label>
                Accepted risk score
                <input
                  type="number"
                  min={0}
                  value={acceptedRiskScore}
                  onChange={(event) => setAcceptedRiskScore(event.target.value)}
                  placeholder="e.g. 12"
                />
              </label>
            </div>
            <div className="sandbox-row">
              <label className="sandbox-notes">
                Approval notes
                <textarea
                  value={approvalNotes}
                  onChange={(event) => setApprovalNotes(event.target.value)}
                  rows={3}
                  placeholder="Optional details for audit trail"
                />
              </label>
            </div>
            <div className="sandbox-actions">
              <button
                type="button"
                onClick={handlePromote}
                disabled={
                  promotionLoading ||
                  report.impact.blocked ||
                  !approver.trim() ||
                  approvalRationale.trim().length < 10 ||
                  !acceptedRiskScore.trim() ||
                  !Number.isFinite(Number(acceptedRiskScore))
                }
              >
                {promotionLoading ? "Promoting..." : "Promote policy"}
              </button>
              {promotionStatus && <span className="sandbox-success">{promotionStatus}</span>}
              {promotionError && <span className="sandbox-error">{promotionError}</span>}
            </div>
          </div>

          <h4>By intent type</h4>
          <table className="sandbox-table">
            <thead>
              <tr>
                <th>Intent</th>
                <th>Count</th>
                <th>Changed</th>
                <th>Baseline (A/W/D)</th>
                <th>Candidate (A/W/D)</th>
              </tr>
            </thead>
            <tbody>
              {report.byIntentType.map((entry) => (
                <tr key={entry.intentType}>
                  <td>{entry.intentType}</td>
                  <td>{entry.count}</td>
                  <td>{entry.changed}</td>
                  <td>
                    {entry.baseline.allow}/{entry.baseline.warn}/{entry.baseline.deny}
                  </td>
                  <td>
                    {entry.candidate.allow}/{entry.candidate.warn}/{entry.candidate.deny}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Top rule changes</h4>
          <ul className="sandbox-list">
            {report.topRuleChanges.map((entry) => (
              <li key={entry.ruleId}>
                <strong>{entry.ruleId}</strong> — {entry.changedCount} changes ({entry.direction})
              </li>
            ))}
          </ul>

          <h4>Top changed examples</h4>
          <ul className="sandbox-list">
            {report.topChangedExamples.map((entry) => (
              <li key={entry.traceId}>
                <button type="button" onClick={() => handleTraceExplain(entry.traceId)}>
                  {entry.traceId}
                </button>
                <span>
                  {entry.intentType}: {entry.baselineDecision} → {entry.candidateDecision}
                </span>
              </li>
            ))}
          </ul>

          <h4>Trace explain</h4>
          <pre className="sandbox-pre">{traceExplain || "Select a trace to load explainability."}</pre>
        </div>
      )}
    </section>
  );
}

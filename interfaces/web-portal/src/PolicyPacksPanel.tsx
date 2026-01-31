import { useEffect, useState } from "react";
import {
  fetchPolicyPack,
  fetchPolicyPacks,
  installPolicyPack,
  type PolicyPackDetails,
  type PolicyPackInstallBundle,
  type PolicyPackSummary
} from "./api";

export function PolicyPacksPanel() {
  const [packs, setPacks] = useState<PolicyPackSummary[]>([]);
  const [selected, setSelected] = useState<PolicyPackDetails | null>(null);
  const [bundle, setBundle] = useState<PolicyPackInstallBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetchPolicyPacks();
        if (!active) {
          return;
        }
        setPacks(response.packs);
      } catch (err) {
        if (!active) {
          return;
        }
        setError((err as Error).message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const handleSelect = async (name: string) => {
    setError("");
    setBundle(null);
    try {
      const response = await fetchPolicyPack(name);
      setSelected(response.pack);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleInstall = async () => {
    if (!selected) {
      return;
    }
    setInstalling(true);
    setError("");
    try {
      const response = await installPolicyPack(selected.name);
      setBundle(response.bundle);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section className="policy-packs">
      <div className="policy-packs-card">
        <div className="policy-packs-header">
          <div>
            <h2>Policy Packs</h2>
            <p>Browse versioned policy bundles, inspect details, and install as candidates.</p>
          </div>
          {loading ? <span className="policy-packs-status">Loading…</span> : null}
        </div>
        {error ? <p className="sandbox-error">{error}</p> : null}
        <div className="policy-packs-grid">
          <div>
            <h3>Available packs</h3>
            {packs.length === 0 ? <p className="policy-packs-muted">No packs found.</p> : null}
            <ul className="policy-packs-list">
              {packs.map((pack) => (
                <li key={pack.name}>
                  <button
                    type="button"
                    className={selected?.name === pack.name ? "policy-packs-item active" : "policy-packs-item"}
                    onClick={() => void handleSelect(pack.name)}
                  >
                    <span>{pack.name}</span>
                    <span className="policy-packs-version">v{pack.version}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Pack details</h3>
            {selected ? (
              <div className="policy-packs-detail">
                <p className="policy-packs-description">{selected.description}</p>
                <ul>
                  <li>
                    <strong>Author:</strong> {selected.author}
                  </li>
                  <li>
                    <strong>Created:</strong> {selected.createdAt}
                  </li>
                  <li>
                    <strong>Policy hash:</strong> {selected.policyHash}
                  </li>
                  <li>
                    <strong>Pack hash:</strong> {selected.packHash}
                  </li>
                  <li>
                    <strong>Signed:</strong> {selected.signed ? "Yes" : "No"}
                  </li>
                </ul>
                {selected.notes ? (
                  <div className="policy-packs-notes">
                    <h4>Notes</h4>
                    <pre>{selected.notes}</pre>
                  </div>
                ) : null}
                <div className="policy-packs-actions">
                  <button type="button" onClick={() => void handleInstall()} disabled={installing}>
                    {installing ? "Installing…" : "Install as candidate"}
                  </button>
                  <a className="policy-packs-link" href="#policy-sandbox">
                    Go to promotion flow
                  </a>
                  <a className="policy-packs-link" href="#policy-counterfactual">
                    View blast radius before install
                  </a>
                </div>
              </div>
            ) : (
              <p className="policy-packs-muted">Select a pack to view details.</p>
            )}
          </div>
        </div>
        {bundle ? (
          <div className="policy-packs-results">
            <h3>Installation results</h3>
            <div className="policy-packs-summary">
              <div>
                <h4>Impact summary</h4>
                <ul>
                  <li>
                    <strong>Intents evaluated:</strong> {bundle.reports.impact.totals.intentsEvaluated}
                  </li>
                  <li>
                    <strong>Newly blocked:</strong> {bundle.reports.impact.totals.newlyBlocked}
                  </li>
                  <li>
                    <strong>Approval escalations:</strong> {bundle.reports.impact.totals.approvalEscalations}
                  </li>
                  <li>
                    <strong>Blast radius score:</strong> {bundle.reports.impact.blastRadiusScore}
                  </li>
                </ul>
              </div>
              <div>
                <h4>Drift health</h4>
                <p className="policy-packs-health">{bundle.reports.drift.health.state}</p>
                {bundle.reports.drift.health.rationale.length ? (
                  <ul>
                    {bundle.reports.drift.health.rationale.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="policy-packs-muted">No drift alerts.</p>
                )}
              </div>
              <div>
                <h4>Guardrail decision</h4>
                <p className={bundle.reports.guardrail.allowed ? "policy-packs-allowed" : "policy-packs-blocked"}>
                  {bundle.reports.guardrail.allowed ? "Allowed" : "Blocked"}
                </p>
                {bundle.reports.guardrail.reasons.length ? (
                  <ul>
                    {bundle.reports.guardrail.reasons.map((reason) => (
                      <li key={reason.code}>
                        {reason.code}: {reason.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="policy-packs-muted">No guardrail violations.</p>
                )}
              </div>
            </div>
            <div className="policy-packs-table">
              <h4>Blast radius details</h4>
              {bundle.reports.impact.rows.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Intent</th>
                      <th>Previous</th>
                      <th>Next</th>
                      <th>Classifications</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.reports.impact.rows.map((row) => (
                      <tr key={row.traceId}>
                        <td>{row.intentType}</td>
                        <td>{row.prevDecision}</td>
                        <td>{row.nextDecision}</td>
                        <td>{row.classifications.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="policy-packs-muted">No impact deltas reported.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

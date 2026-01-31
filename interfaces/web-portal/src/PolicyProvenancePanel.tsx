import { useState } from "react";
import {
  fetchPolicyProvenance,
  fetchPolicyProvenanceMarkdown,
  type PolicyProvenanceReport
} from "./api";

function downloadFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PolicyProvenancePanel() {
  const [policyHash, setPolicyHash] = useState("");
  const [report, setReport] = useState<PolicyProvenanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");

  const handleGenerate = async () => {
    const trimmed = policyHash.trim();
    if (!trimmed) {
      return;
    }
    setLoading(true);
    setError("");
    setDownloadStatus("");
    try {
      const response = await fetchPolicyProvenance(trimmed);
      setReport(response.report);
    } catch (err) {
      setError((err as Error).message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadJson = () => {
    if (!report) {
      return;
    }
    downloadFile(`policy-provenance-${report.policyHash}.json`, JSON.stringify(report, null, 2), "application/json");
    setDownloadStatus("Downloaded JSON report.");
  };

  const handleDownloadMarkdown = async () => {
    const trimmed = policyHash.trim();
    if (!trimmed) {
      return;
    }
    setDownloadStatus("");
    try {
      const markdown = await fetchPolicyProvenanceMarkdown(trimmed);
      downloadFile(`policy-provenance-${trimmed}.md`, markdown, "text/markdown");
      setDownloadStatus("Downloaded Markdown report.");
    } catch (err) {
      setDownloadStatus(`Download failed: ${(err as Error).message}`);
    }
  };

  const integrityLabel = report?.determinism.verified ? "Verified" : "Mismatch";
  const integrityClass = report?.determinism.verified ? "integrity-badge-ok" : "integrity-badge-warn";

  return (
    <section className="policy-provenance">
      <div className="provenance-card">
        <div className="provenance-header">
          <div>
            <h2>Policy Provenance</h2>
            <p>Generate a deterministic audit snapshot for a policy hash.</p>
          </div>
          {report ? <span className={`integrity-badge ${integrityClass}`}>{integrityLabel}</span> : null}
        </div>
        <div className="provenance-controls">
          <label className="provenance-label" htmlFor="policy-provenance-hash">
            Policy hash
          </label>
          <div className="provenance-row">
            <input
              id="policy-provenance-hash"
              type="text"
              value={policyHash}
              onChange={(event) => setPolicyHash(event.target.value)}
              placeholder="Enter policy hash"
            />
            <button type="button" onClick={handleGenerate} disabled={loading || !policyHash.trim()}>
              {loading ? "Generating..." : "Generate"}
            </button>
          </div>
        </div>
        {error ? <p className="sandbox-error">{error}</p> : null}
        {report ? (
          <div className="provenance-summary">
            <div className="provenance-summary-grid">
              <div>
                <h3>Summary</h3>
                <ul>
                  <li>
                    <strong>Policy:</strong> {report.policyHash}
                  </li>
                  <li>
                    <strong>Report Hash:</strong> {report.reportHash}
                  </li>
                  <li>
                    <strong>As Of:</strong> {report.asOf}
                  </li>
                  <li>
                    <strong>Lifecycle:</strong> {report.lifecycle.state}
                  </li>
                  <li>
                    <strong>Guardrail Checks:</strong> {report.guardrailChecks.length}
                  </li>
                  <li>
                    <strong>Approvals:</strong> {report.approvals.length}
                  </li>
                </ul>
              </div>
              <div>
                <h3>Integrity</h3>
                <ul>
                  <li>
                    <strong>Verified:</strong> {report.determinism.verified ? "Yes" : "No"}
                  </li>
                  <li>
                    <strong>Events:</strong> {report.determinism.eventCount}
                  </li>
                  <li>
                    <strong>Last Event Hash:</strong> {report.determinism.lastEventHash ?? "n/a"}
                  </li>
                </ul>
              </div>
            </div>
            <div className="provenance-actions">
              <button type="button" onClick={handleDownloadJson}>
                Download JSON
              </button>
              <button type="button" onClick={() => void handleDownloadMarkdown()}>
                Download MD
              </button>
              {downloadStatus ? <span className="provenance-status">{downloadStatus}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

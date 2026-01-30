import { useState } from "react";
import { fetchTraceExplain } from "./api";

export function TraceViewer() {
  const [traceId, setTraceId] = useState("");
  const [response, setResponse] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!traceId.trim()) {
      return;
    }

    setLoading(true);
    try {
      const result = await fetchTraceExplain(traceId.trim());
      setResponse(JSON.stringify(result, null, 2));
    } catch (error) {
      setResponse(JSON.stringify({ error: (error as Error).message }, null, 2));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="trace-viewer">
      <h2>Trace Viewer</h2>
      <p>Paste a trace ID to inspect intent and saga details.</p>
      <form onSubmit={handleSubmit} className="trace-form">
        <input
          type="text"
          value={traceId}
          onChange={(event) => setTraceId(event.target.value)}
          placeholder="trace-id"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Loading..." : "Explain Trace"}
        </button>
      </form>
      <pre>{response || "No trace loaded yet."}</pre>
    </section>
  );
}

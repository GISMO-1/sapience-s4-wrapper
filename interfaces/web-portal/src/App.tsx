import { useState } from "react";
import { fetchTrace, sendIntent } from "./api";

export function App() {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [traceId, setTraceId] = useState("");
  const [traceResponse, setTraceResponse] = useState<string>("");
  const [traceLoading, setTraceLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim()) {
      return;
    }

    setLoading(true);
    try {
      const result = await sendIntent(input.trim());
      setResponse(JSON.stringify(result, null, 2));
    } catch (error) {
      setResponse(JSON.stringify({ error: (error as Error).message }, null, 2));
    } finally {
      setLoading(false);
    }
  };

  const handleTraceLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!traceId.trim()) {
      return;
    }

    setTraceLoading(true);
    try {
      const result = await fetchTrace(traceId.trim());
      setTraceResponse(JSON.stringify(result, null, 2));
    } catch (error) {
      setTraceResponse(JSON.stringify({ error: (error as Error).message }, null, 2));
    } finally {
      setTraceLoading(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Sapience Portal</h1>
        <p>Send a simple intent to the API gateway.</p>
      </header>
      <form onSubmit={handleSubmit} className="chat-form">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Try: create a PO for laptops"
          rows={4}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send"}
        </button>
      </form>
      <section className="response">
        <h2>Response</h2>
        <pre>{response || "No response yet."}</pre>
      </section>
      <section className="trace-viewer">
        <h2>Trace Viewer</h2>
        <p>Paste a trace ID to see the intent, saga timeline, and outcome.</p>
        <form onSubmit={handleTraceLookup} className="chat-form">
          <input
            type="text"
            value={traceId}
            onChange={(event) => setTraceId(event.target.value)}
            placeholder="Trace ID"
          />
          <button type="submit" disabled={traceLoading}>
            {traceLoading ? "Loading..." : "Fetch trace"}
          </button>
        </form>
        <pre>{traceResponse || "No trace loaded yet."}</pre>
      </section>
    </div>
  );
}

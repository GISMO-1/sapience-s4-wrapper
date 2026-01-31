import { useState } from "react";
import { sendIntent } from "./api";
import { PolicySandbox } from "./PolicySandbox";
import { TraceViewer } from "./TraceViewer";
import { PolicyProvenancePanel } from "./PolicyProvenancePanel";
import { PolicyPacksPanel } from "./PolicyPacksPanel";

export function App() {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState<string>("");
  const [loading, setLoading] = useState(false);

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
      <PolicySandbox />
      <TraceViewer />
      <PolicyProvenancePanel />
      <PolicyPacksPanel />
    </div>
  );
}

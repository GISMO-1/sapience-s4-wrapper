const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export async function sendIntent(text: string) {
  const response = await fetch(`${API_BASE}/v1/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error("Intent request failed");
  }

  return response.json();
}

export async function fetchTrace(traceId: string) {
  const response = await fetch(`${API_BASE}/v1/explain/${encodeURIComponent(traceId)}`);
  if (!response.ok) {
    throw new Error("Trace lookup failed");
  }
  return response.json();
}

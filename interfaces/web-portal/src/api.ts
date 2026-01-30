const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

const API_ROOT = API_BASE || window.location.origin;

function buildUrl(path: string) {
  return `${API_ROOT}${path}`;
}

export async function sendIntent(text: string) {
  const response = await fetch(buildUrl("/v1/intent"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error("Intent request failed");
  }

  return response.json();
}

export async function fetchTraceExplain(traceId: string) {
  const response = await fetch(buildUrl(`/v1/assist/explain/${encodeURIComponent(traceId)}`));

  if (!response.ok) {
    throw new Error("Trace explain request failed");
  }

  return response.json();
}

export type ReplayCandidateSource = "current" | "path" | "inline";

export type ReplayReport = {
  traceId: string;
  run: {
    runId: string;
    createdAt: string;
    baseline: { hash: string };
    candidate: { hash: string; source: ReplayCandidateSource; ref?: string };
    filters: { intentTypes?: string[]; since?: string; until?: string; limit: number };
  };
  totals: {
    count: number;
    changed: number;
    unchanged: number;
    baseline: { allow: number; warn: number; deny: number };
    candidate: { allow: number; warn: number; deny: number };
  };
  deltas: { allowDelta: number; warnDelta: number; denyDelta: number };
  byIntentType: Array<{
    intentType: string;
    count: number;
    changed: number;
    baseline: { allow: number; warn: number; deny: number };
    candidate: { allow: number; warn: number; deny: number };
  }>;
  topRuleChanges: Array<{
    ruleId: string;
    direction: "more_strict" | "less_strict" | "mixed";
    changedCount: number;
    examples: Array<{ traceId: string; baselineDecision: string; candidateDecision: string }>;
  }>;
  topChangedExamples: Array<{
    traceId: string;
    intentType: string;
    baselineDecision: string;
    candidateDecision: string;
    baselineRules: string[];
    candidateRules: string[];
  }>;
};

export async function runPolicyReplay(payload: {
  candidatePolicy?: { source: ReplayCandidateSource; ref?: string; yaml?: string };
  filters?: { limit?: number; intentTypes?: string[] };
  requestedBy?: string;
}) {
  const response = await fetch(buildUrl("/v1/policy/replay"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Policy replay request failed");
  }

  return response.json();
}

export async function fetchReplayReport(runId: string): Promise<ReplayReport> {
  const response = await fetch(buildUrl(`/v1/policy/replay/${encodeURIComponent(runId)}/report`));

  if (!response.ok) {
    throw new Error("Replay report request failed");
  }

  return response.json();
}

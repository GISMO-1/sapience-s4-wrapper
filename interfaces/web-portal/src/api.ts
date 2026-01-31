const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const NORMALIZED_API_BASE = API_BASE.replace(/\/$/, "");

function buildUrl(path: string) {
  if (!NORMALIZED_API_BASE) {
    return path;
  }
  return `${NORMALIZED_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  const text = await res.text();
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON, got ${contentType || "unknown"}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
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

export type PolicyImpactReport = {
  score: number;
  weights: {
    changedDecisions: number;
    denyToAllowFlips: number;
    rateLimitViolations: number;
    highRiskSignals: number;
  };
  counts: {
    changedDecisions: number;
    denyToAllowFlips: number;
    rateLimitViolations: number;
    highRiskSignals: number;
  };
  thresholds: {
    score: number;
    changedDecisions: number;
    denyToAllowFlips: number;
    rateLimitViolations: number;
    highRiskSignals: number;
  };
  exceeded: string[];
  blocked: boolean;
};

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
  impact: PolicyImpactReport;
  outcomeOverlay?: {
    policyHash: string;
    window: { since: string; until: string };
    metrics: {
      totalOutcomes: number;
      failureRate: number;
      overrideRate: number;
      weightedPenalty: number;
      qualityScore: number;
    };
  };
};

export type PolicyReplayResponse = {
  run: {
    runId: string;
  };
};

export async function runPolicyReplay(payload: {
  candidatePolicy?: { source: ReplayCandidateSource; ref?: string; yaml?: string };
  filters?: { limit?: number; intentTypes?: string[] };
  requestedBy?: string;
}): Promise<PolicyReplayResponse> {
  return fetchJson<PolicyReplayResponse>(buildUrl("/v1/policy/replay"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function fetchReplayReport(runId: string): Promise<ReplayReport> {
  return fetchJson(buildUrl(`/v1/policy/replay/${encodeURIComponent(runId)}/report`));
}

export async function promotePolicy(payload: {
  runId: string;
  approvedBy: string;
  rationale: string;
  acceptedRiskScore: number;
  reason?: string;
  notes?: string;
}) {
  const response = await fetch(buildUrl("/v1/policy/promote"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const message = typeof errorPayload.message === "string" ? errorPayload.message : "Policy promotion failed";
    throw new Error(message);
  }

  return response.json();
}

export async function fetchPolicyStatus() {
  const response = await fetch(buildUrl("/v1/policy/status"));

  if (!response.ok) {
    throw new Error("Policy status request failed");
  }

  return response.json();
}

export type PolicyDriftSummary = {
  constraintsAdded: number;
  constraintsRemoved: number;
  severityDelta: number;
  netRiskScoreChange: number;
};

export type PolicyLineageRecord = {
  policyHash: string;
  parentPolicyHash: string | null;
  promotedBy: string;
  promotedAt: string;
  rationale: string;
  acceptedRiskScore: number;
  source: "replay" | "manual";
  drift: PolicyDriftSummary;
};

export type PolicyLineageResponse = {
  traceId: string;
  policyHash: string;
  lineage: PolicyLineageRecord[];
};

export async function fetchPolicyLineageCurrent(): Promise<PolicyLineageResponse> {
  return fetchJson(buildUrl("/v1/policy/lineage/current"));
}

export async function fetchPolicyLineageByHash(policyHash: string): Promise<PolicyLineageResponse> {
  return fetchJson(buildUrl(`/v1/policy/lineage/${encodeURIComponent(policyHash)}`));
}

export type PolicyOutcomeType = "success" | "failure" | "override" | "rollback";

export type PolicyQualityResponse = {
  traceId: string;
  policyHash: string;
  window: { since: string | null; until: string | null };
  metrics: {
    totalOutcomes: number;
    failureRate: number;
    overrideRate: number;
    weightedPenalty: number;
    qualityScore: number;
  };
};

export async function recordPolicyOutcome(payload: {
  traceId: string;
  outcomeType: PolicyOutcomeType;
  severity?: number;
  humanOverride?: boolean;
  notes?: string;
}) {
  return fetchJson(buildUrl("/v1/policy/outcomes"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function fetchPolicyQuality(policyHash: string): Promise<PolicyQualityResponse> {
  return fetchJson(buildUrl(`/v1/policy/quality?policyHash=${encodeURIComponent(policyHash)}`));
}

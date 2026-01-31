import type { Intent } from "../intent/intent-model";
import type { PolicyDecision, PolicyDecisionResult, PolicyReason, RiskAssessment } from "../policy-code/types";
import type { PolicyImpactReport } from "../policy-lifecycle/types";
import type { PolicyQualityMetrics } from "../policy-quality/types";

export type ReplayCandidateSource = "current" | "path" | "inline";

export type ReplayCandidatePolicy = {
  source: ReplayCandidateSource;
  ref?: string;
  yaml?: string;
};

export type ReplayFilters = {
  intentTypes?: string[];
  since?: Date;
  until?: Date;
  limit?: number;
};

export type ReplayRunFilters = {
  policyHash?: string;
  since?: Date;
  until?: Date;
  limit?: number;
};

export type ReplayBaselineIntent = {
  traceId: string;
  intentType: Intent["intentType"];
  intent: Intent;
  createdAt: Date;
  baselineDecision: PolicyDecision;
  baselineMatchedRules: string[];
  baselinePolicyHash: string;
  baselineRisk: RiskAssessment;
};

export type ReplayRunInput = {
  requestedBy?: string;
  baselinePolicyHash: string;
  candidatePolicyHash: string;
  candidatePolicySource: ReplayCandidateSource;
  candidatePolicyRef?: string | null;
  intentTypeFilter?: string[] | null;
  since?: Date | null;
  until?: Date | null;
  limit: number;
};

export type ReplayRunRecord = {
  id: string;
  requestedBy?: string | null;
  baselinePolicyHash: string;
  candidatePolicyHash: string;
  candidatePolicySource: ReplayCandidateSource;
  candidatePolicyRef?: string | null;
  intentTypeFilter?: string[] | null;
  since?: Date | null;
  until?: Date | null;
  limit: number;
  createdAt: Date;
};

export type ReplayResultRecord = {
  id: string;
  runId: string;
  traceId: string;
  intentType: Intent["intentType"];
  baselineDecision: PolicyDecision;
  candidateDecision: PolicyDecision;
  changed: boolean;
  baselinePolicyHash: string;
  candidatePolicyHash: string;
  baselineMatchedRules: string[];
  candidateMatchedRules: string[];
  candidateConstraintTypes: string[];
  baselineRisk: RiskAssessment;
  reasons: PolicyReason[];
  categories: string[];
  risk: RiskAssessment;
  createdAt: Date;
};

export type ReplayTotals = {
  count: number;
  changed: number;
  allow: number;
  warn: number;
  deny: number;
};

export type ReplayChangedExample = {
  traceId: string;
  intentType: Intent["intentType"];
  baselineDecision: PolicyDecision;
  candidateDecision: PolicyDecision;
  rulesChanged: {
    added: string[];
    removed: string[];
  };
};

export type ReplaySummary = {
  runId: string;
  baseline: { hash: string };
  candidate: { hash: string; source: ReplayCandidateSource; ref?: string | null };
  totals: ReplayTotals;
  changedExamples: ReplayChangedExample[];
};

export type ReplayRunDetails = ReplaySummary & {
  createdAt: Date;
  requestedBy?: string | null;
  filters: {
    intentTypes?: string[] | null;
    since?: Date | null;
    until?: Date | null;
    limit: number;
  };
  results: ReplayResultRecord[];
};

export type ReplayCandidateEvaluation = {
  decision: PolicyDecisionResult;
  matchedRuleIds: string[];
  constraintTypes: string[];
  reasons: PolicyReason[];
  categories: string[];
  risk: RiskAssessment;
};

export type ReplayReportTotals = {
  count: number;
  changed: number;
  unchanged: number;
  baseline: { allow: number; warn: number; deny: number };
  candidate: { allow: number; warn: number; deny: number };
};

export type ReplayReport = {
  run: {
    runId: string;
    createdAt: Date;
    baseline: { hash: string };
    candidate: { hash: string; source: ReplayCandidateSource; ref?: string };
    filters: {
      intentTypes?: string[];
      since?: Date;
      until?: Date;
      limit: number;
    };
  };
  totals: ReplayReportTotals;
  deltas: {
    allowDelta: number;
    warnDelta: number;
    denyDelta: number;
  };
  byIntentType: Array<{
    intentType: Intent["intentType"];
    count: number;
    changed: number;
    baseline: { allow: number; warn: number; deny: number };
    candidate: { allow: number; warn: number; deny: number };
  }>;
  topRuleChanges: Array<{
    ruleId: string;
    direction: "more_strict" | "less_strict" | "mixed";
    changedCount: number;
    examples: Array<{ traceId: string; baselineDecision: PolicyDecision; candidateDecision: PolicyDecision }>;
  }>;
  topChangedExamples: Array<{
    traceId: string;
    intentType: Intent["intentType"];
    baselineDecision: PolicyDecision;
    candidateDecision: PolicyDecision;
    baselineRules: string[];
    candidateRules: string[];
  }>;
  impact: PolicyImpactReport;
  outcomeOverlay?: {
    policyHash: string;
    window: {
      since: string;
      until: string;
    };
    metrics: PolicyQualityMetrics;
  };
};

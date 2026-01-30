import { randomUUID } from "node:crypto";
import { createPolicyEvaluator, InMemoryRateLimiter } from "../policy-code/evaluator";
import type { CandidatePolicySnapshot } from "../policy-code/loader";
import type { ExecutionMode, PolicyDecision } from "../policy-code/types";
import type { PolicyReplayStore } from "./replay-store";
import type {
  ReplayBaselineIntent,
  ReplayCandidateEvaluation,
  ReplayFilters,
  ReplayResultRecord,
  ReplayRunDetails,
  ReplaySummary
} from "./types";

const DEFAULT_LIMIT = 100;
const EXAMPLE_LIMIT = 10;

function normalizeLimit(limit?: number): number {
  if (!limit || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return limit;
}

function compareRuleLists(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function computeRuleDiff(baseline: string[], candidate: string[]): { added: string[]; removed: string[] } {
  const baselineSet = new Set(baseline);
  const candidateSet = new Set(candidate);
  const added = Array.from(candidateSet).filter((rule) => !baselineSet.has(rule)).sort();
  const removed = Array.from(baselineSet).filter((rule) => !candidateSet.has(rule)).sort();
  return { added, removed };
}

function buildCandidateEvaluator(snapshot: CandidatePolicySnapshot, now: () => number) {
  const loader = {
    getSnapshot: () => ({
      policy: snapshot.policy,
      info: snapshot.info,
      source: "loaded" as const
    }),
    reload: () => ({
      policy: snapshot.policy,
      info: snapshot.info,
      source: "loaded" as const
    })
  };
  return createPolicyEvaluator({ loader, limiter: new InMemoryRateLimiter(now) });
}

function buildCandidateEvaluation(
  intent: ReplayBaselineIntent,
  executionMode: ExecutionMode,
  evaluator: ReturnType<typeof buildCandidateEvaluator>
): ReplayCandidateEvaluation {
  const decision = evaluator.evaluate(intent.intent, { executionMode, traceId: intent.traceId });
  return {
    decision,
    matchedRuleIds: decision.matchedRules.map((rule) => rule.ruleId),
    reasons: decision.reasons,
    categories: decision.categories,
    risk: decision.risk
  };
}

function countDecision(decisions: PolicyDecision[]): { allow: number; warn: number; deny: number } {
  return {
    allow: decisions.filter((decision) => decision === "ALLOW").length,
    warn: decisions.filter((decision) => decision === "WARN").length,
    deny: decisions.filter((decision) => decision === "DENY").length
  };
}

function deriveBaselinePolicyHash(items: ReplayBaselineIntent[]): string {
  const hashes = Array.from(new Set(items.map((item) => item.baselinePolicyHash)));
  if (hashes.length === 0) {
    return "none";
  }
  if (hashes.length === 1) {
    return hashes[0];
  }
  return "mixed";
}

export function createPolicyReplayEngine(store: PolicyReplayStore) {
  const runReplay = async (input: {
    candidate: CandidatePolicySnapshot;
    filters?: ReplayFilters;
    requestedBy?: string;
    executionMode: ExecutionMode;
  }): Promise<ReplaySummary> => {
    const filters = input.filters ?? {};
    const limit = normalizeLimit(filters.limit);
    const baselineIntents = await store.listBaselineIntents({
      intentTypes: filters.intentTypes,
      since: filters.since,
      until: filters.until,
      limit
    });

    const baselinePolicyHash = deriveBaselinePolicyHash(baselineIntents);
    const run = await store.createRun({
      requestedBy: input.requestedBy,
      baselinePolicyHash,
      candidatePolicyHash: input.candidate.info.hash,
      candidatePolicySource: input.candidate.source,
      candidatePolicyRef: input.candidate.ref ?? null,
      intentTypeFilter: filters.intentTypes ?? null,
      since: filters.since ?? null,
      until: filters.until ?? null,
      limit
    });

    let currentTime = 0;
    const now = () => currentTime;
    const evaluator = buildCandidateEvaluator(input.candidate, now);
    const results: ReplayResultRecord[] = [];
    const decisions: PolicyDecision[] = [];

    baselineIntents.forEach((intent) => {
      currentTime = intent.createdAt.getTime();
      const evaluation = buildCandidateEvaluation(intent, input.executionMode, evaluator);
      const changed =
        intent.baselineDecision !== evaluation.decision.final ||
        !compareRuleLists(intent.baselineMatchedRules, evaluation.matchedRuleIds);

      results.push({
        id: randomUUID(),
        runId: run.id,
        traceId: intent.traceId,
        intentType: intent.intentType,
        baselineDecision: intent.baselineDecision,
        candidateDecision: evaluation.decision.final,
        changed,
        baselinePolicyHash: intent.baselinePolicyHash,
        candidatePolicyHash: input.candidate.info.hash,
        baselineMatchedRules: intent.baselineMatchedRules,
        candidateMatchedRules: evaluation.matchedRuleIds,
        reasons: evaluation.reasons,
        categories: evaluation.categories,
        risk: evaluation.risk,
        createdAt: intent.createdAt
      });
      decisions.push(evaluation.decision.final);
    });

    await store.saveResults(run.id, results);

    const changedExamples = results
      .filter((result) => result.changed)
      .slice(0, EXAMPLE_LIMIT)
      .map((result) => ({
        traceId: result.traceId,
        intentType: result.intentType,
        baselineDecision: result.baselineDecision,
        candidateDecision: result.candidateDecision,
        rulesChanged: computeRuleDiff(result.baselineMatchedRules, result.candidateMatchedRules)
      }));

    const decisionCounts = countDecision(decisions);
    const totals = {
      count: results.length,
      changed: results.filter((result) => result.changed).length,
      allow: decisionCounts.allow,
      warn: decisionCounts.warn,
      deny: decisionCounts.deny
    };

    return {
      runId: run.id,
      baseline: { hash: baselinePolicyHash },
      candidate: {
        hash: input.candidate.info.hash,
        source: input.candidate.source,
        ref: input.candidate.ref ?? null
      },
      totals,
      changedExamples
    };
  };

  const getRunSummary = async (runId: string, options?: { limit?: number }): Promise<ReplayRunDetails | null> => {
    const run = await store.getRun(runId);
    if (!run) {
      return null;
    }
    const results = await store.getResults(runId, { limit: options?.limit ?? 50 });
    const totals = await store.getRunTotals(runId);
    const changedExamples = results
      .filter((result) => result.changed)
      .slice(0, EXAMPLE_LIMIT)
      .map((result) => ({
        traceId: result.traceId,
        intentType: result.intentType,
        baselineDecision: result.baselineDecision,
        candidateDecision: result.candidateDecision,
        rulesChanged: computeRuleDiff(result.baselineMatchedRules, result.candidateMatchedRules)
      }));

    return {
      runId: run.id,
      baseline: { hash: run.baselinePolicyHash },
      candidate: {
        hash: run.candidatePolicyHash,
        source: run.candidatePolicySource,
        ref: run.candidatePolicyRef ?? null
      },
      totals,
      changedExamples,
      createdAt: run.createdAt,
      requestedBy: run.requestedBy ?? null,
      filters: {
        intentTypes: run.intentTypeFilter ?? null,
        since: run.since ?? null,
        until: run.until ?? null,
        limit: run.limit
      },
      results
    };
  };

  const getRunResults = async (runId: string, options?: { changed?: boolean; limit?: number; offset?: number }) => {
    return store.getResults(runId, options);
  };

  return { runReplay, getRunSummary, getRunResults };
}

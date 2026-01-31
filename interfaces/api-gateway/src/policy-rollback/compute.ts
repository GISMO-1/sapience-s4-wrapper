import type { PolicyEvaluator } from "../policy-code/evaluator";
import type { PolicyLifecycleStore } from "../policy-lifecycle/store";
import type { PolicyLineageStore } from "../policy-lineage/store";
import { canonicalJson, sha256 } from "../policy-events/hash";
import type { PolicyRollbackStore } from "./store";
import type { RollbackDecision, RollbackEvent, RollbackRequest } from "./types";

function normalizeReasons(reasons: string[]): string[] {
  return reasons.slice().sort((a, b) => a.localeCompare(b));
}

function buildDecisionHash(decision: Omit<RollbackDecision, "decisionHash">): string {
  const normalized = {
    ...decision,
    reasons: normalizeReasons(decision.reasons)
  };
  return sha256(canonicalJson(normalized));
}

function buildEventHash(event: Omit<RollbackEvent, "eventHash">): string {
  const normalized = {
    ...event,
    createdAt: event.createdAt
  };
  return sha256(canonicalJson(normalized));
}

function resolveActivePolicyHash(lifecycleStore: PolicyLifecycleStore, evaluator: PolicyEvaluator): string {
  return lifecycleStore.getActivePolicy()?.policyHash ?? evaluator.getPolicySnapshot().info.hash;
}

function resolveLifecycleActivation(input: {
  lifecycleStore: PolicyLifecycleStore;
  evaluator: PolicyEvaluator;
  targetPolicyHash: string;
  now: Date;
}): void {
  const status = input.lifecycleStore.getStatus(input.targetPolicyHash);
  const fallback = input.evaluator.getPolicySnapshot().info;
  const version = status?.version ?? fallback.version ?? "unknown";
  const path = status?.path ?? status?.ref ?? fallback.path ?? "unknown";
  const loadedAt = status?.loadedAt ?? fallback.loadedAt ?? input.now.toISOString();
  input.lifecycleStore.setActivePolicy({
    hash: input.targetPolicyHash,
    version,
    path,
    loadedAt
  });
}

export async function computeRollbackDecision(input: {
  request: RollbackRequest;
  lineageStore: PolicyLineageStore;
  lifecycleStore: PolicyLifecycleStore;
  rollbackStore: PolicyRollbackStore;
  evaluator: PolicyEvaluator;
  now?: Date;
}): Promise<{ decision: RollbackDecision; event: RollbackEvent | null }> {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const fromPolicyHash = resolveActivePolicyHash(input.lifecycleStore, input.evaluator);
  const toPolicyHash = input.request.targetPolicyHash;

  const reasons: string[] = [];
  const targetLineage = await input.lineageStore.getLineage(toPolicyHash);
  if (!targetLineage) {
    reasons.push("Target policy hash is not present in the lineage store.");
  }
  if (toPolicyHash === fromPolicyHash) {
    reasons.push("Target policy hash matches the active policy hash.");
  }

  const ok = reasons.length === 0;
  const decisionBase: Omit<RollbackDecision, "decisionHash"> = {
    ok,
    fromPolicyHash,
    toPolicyHash,
    reasons: normalizeReasons(reasons),
    createdAt
  };
  const decisionHash = buildDecisionHash(decisionBase);
  const decision: RollbackDecision = {
    ...decisionBase,
    decisionHash
  };

  if (!ok || input.request.dryRun) {
    return { decision, event: null };
  }

  resolveLifecycleActivation({
    lifecycleStore: input.lifecycleStore,
    evaluator: input.evaluator,
    targetPolicyHash: toPolicyHash,
    now
  });

  const eventBase: Omit<RollbackEvent, "eventHash"> = {
    eventType: "ROLLBACK",
    fromPolicyHash,
    toPolicyHash,
    actor: input.request.actor,
    rationale: input.request.rationale,
    createdAt
  };
  const event: RollbackEvent = {
    ...eventBase,
    eventHash: buildEventHash(eventBase)
  };

  await input.rollbackStore.recordRollback({
    ...event,
    createdAt: new Date(event.createdAt).toISOString(),
    fromPolicyHash: event.fromPolicyHash,
    toPolicyHash: event.toPolicyHash,
    actor: event.actor,
    rationale: event.rationale,
    eventType: event.eventType,
    eventHash: event.eventHash
  });

  return { decision, event };
}

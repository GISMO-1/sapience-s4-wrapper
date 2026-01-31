import { buildEventHash } from "./hash";
import type { PolicyEvent } from "./types";
import { createPolicyReplayStore } from "../policy-replay/replay-store";
import { createPolicyOutcomeStore } from "../policy-outcomes/store";
import { createPolicyGuardrailCheckStore } from "../policy-promotion-guardrails/store";
import { createPolicyApprovalStore } from "../policy-approvals/store";
import { createPolicyLineageStore } from "../policy-lineage/store";
import type { PolicyReplayStore } from "../policy-replay/replay-store";
import type { PolicyOutcomeStore } from "../policy-outcomes/store";
import type { GuardrailCheckStore } from "../policy-promotion-guardrails/store";
import type { PolicyApprovalStore } from "../policy-approvals/store";
import type { PolicyLineageStore } from "../policy-lineage/store";

export type PolicyEventLogOptions = {
  policyHash: string;
  since?: Date;
  until?: Date;
  limit?: number;
  stores?: {
    replayStore?: PolicyReplayStore;
    outcomeStore?: PolicyOutcomeStore;
    guardrailCheckStore?: GuardrailCheckStore;
    approvalStore?: PolicyApprovalStore;
    lineageStore?: PolicyLineageStore;
  };
};

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function withinRange(value: string, since?: Date, until?: Date): boolean {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return false;
  }
  if (since && time < since.getTime()) {
    return false;
  }
  if (until && time > until.getTime()) {
    return false;
  }
  return true;
}

function withHash(event: Omit<PolicyEvent, "eventHash">): PolicyEvent {
  return { ...event, eventHash: buildEventHash(event) } as PolicyEvent;
}

function sortEvents(a: PolicyEvent, b: PolicyEvent): number {
  const timeDiff = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }
  if (a.kind !== b.kind) {
    return a.kind.localeCompare(b.kind);
  }
  return a.eventId.localeCompare(b.eventId);
}

export async function buildPolicyEventLog(options: PolicyEventLogOptions): Promise<PolicyEvent[]> {
  const replayStore = options.stores?.replayStore ?? createPolicyReplayStore();
  const outcomeStore = options.stores?.outcomeStore ?? createPolicyOutcomeStore();
  const guardrailCheckStore = options.stores?.guardrailCheckStore ?? createPolicyGuardrailCheckStore();
  const approvalStore = options.stores?.approvalStore ?? createPolicyApprovalStore();
  const lineageStore = options.stores?.lineageStore ?? createPolicyLineageStore();
  const limit = options.limit ?? 500;

  const [runs, outcomes, guardrailChecks, approvals, lineage] = await Promise.all([
    replayStore.listRuns({
      policyHash: options.policyHash,
      since: options.since,
      until: options.until,
      limit
    }),
    outcomeStore.listOutcomes({
      policyHash: options.policyHash,
      since: options.since,
      until: options.until,
      limit
    }),
    guardrailCheckStore.listChecks(options.policyHash),
    approvalStore.listApprovals(options.policyHash),
    lineageStore.getLineage(options.policyHash)
  ]);

  const runEvents = runs.map((run) =>
    withHash({
      eventId: `policy-replay-run:${run.id}`,
      occurredAt: run.createdAt.toISOString(),
      actor: run.requestedBy ?? null,
      traceId: null,
      policyHash: run.candidatePolicyHash,
      kind: "POLICY_REPLAY_RUN_STARTED",
      payload: {
        runId: run.id,
        baselinePolicyHash: run.baselinePolicyHash,
        candidatePolicyHash: run.candidatePolicyHash,
        candidatePolicySource: run.candidatePolicySource,
        candidatePolicyRef: run.candidatePolicyRef ?? null,
        intentTypeFilter: run.intentTypeFilter ?? null,
        since: toIso(run.since),
        until: toIso(run.until),
        limit: run.limit
      },
      parentEventId: null
    })
  );

  const resultEvents = [] as PolicyEvent[];
  for (const run of runs) {
    const results = await replayStore.getResults(run.id, { limit: run.limit, offset: 0 });
    results.forEach((result) => {
      resultEvents.push(
        withHash({
          eventId: `policy-replay-result:${result.id}`,
          occurredAt: result.createdAt.toISOString(),
          actor: null,
          traceId: result.traceId,
          policyHash: result.candidatePolicyHash,
          kind: "POLICY_REPLAY_RESULT_RECORDED",
          payload: {
            resultId: result.id,
            runId: run.id,
            traceId: result.traceId,
            intentType: result.intentType,
            baselineDecision: result.baselineDecision,
            candidateDecision: result.candidateDecision,
            changed: result.changed,
            baselinePolicyHash: result.baselinePolicyHash,
            candidatePolicyHash: result.candidatePolicyHash,
            baselineMatchedRules: result.baselineMatchedRules,
            candidateMatchedRules: result.candidateMatchedRules,
            candidateConstraintTypes: result.candidateConstraintTypes,
            baselineRisk: result.baselineRisk,
            risk: result.risk
          },
          parentEventId: `policy-replay-run:${run.id}`
        })
      );
    });
  }

  const outcomeEvents = outcomes.map((outcome) =>
    withHash({
      eventId: `policy-outcome:${outcome.id}`,
      occurredAt: outcome.observedAt.toISOString(),
      actor: null,
      traceId: outcome.traceId,
      policyHash: outcome.policyHash,
      kind: "POLICY_OUTCOME_RECORDED",
      payload: {
        outcomeId: outcome.id,
        traceId: outcome.traceId,
        intentType: outcome.intentType,
        decision: outcome.decision,
        outcomeType: outcome.outcomeType,
        severity: outcome.severity,
        humanOverride: outcome.humanOverride,
        notes: outcome.notes ?? null
      },
      parentEventId: null
    })
  );

  const guardrailEvents = guardrailChecks
    .filter((check) => withinRange(check.evaluatedAt, options.since, options.until))
    .map((check) =>
      withHash({
        eventId: `policy-guardrail-check:${check.id}`,
        occurredAt: check.evaluatedAt,
        actor: check.actor,
        traceId: null,
        policyHash: check.policyHash,
        kind: "POLICY_PROMOTION_GUARDRAIL_CHECKED",
        payload: {
          checkId: check.id,
          actor: check.actor,
          rationale: check.rationale,
          decision: check.decision
        },
        parentEventId: null
      })
    );

  const approvalEvents = approvals
    .filter((approval) => withinRange(approval.approvedAt, options.since, options.until))
    .map((approval) =>
      withHash({
        eventId: `policy-approval:${approval.id}`,
        occurredAt: approval.approvedAt,
        actor: approval.approvedBy,
        traceId: null,
        policyHash: approval.policyHash,
        kind: "POLICY_APPROVAL_RECORDED",
        payload: {
          approvalId: approval.id,
          approvedBy: approval.approvedBy,
          rationale: approval.rationale,
          acceptedRiskScore: approval.acceptedRiskScore ?? null,
          notes: approval.notes ?? null,
          runId: approval.runId ?? null,
          approvedAt: approval.approvedAt
        },
        parentEventId: null
      })
    );

  const promotionEvents =
    lineage && withinRange(lineage.promotedAt, options.since, options.until)
      ? [
          withHash({
            eventId: `policy-promoted:${lineage.policyHash}:${lineage.promotedAt}`,
            occurredAt: lineage.promotedAt,
            actor: lineage.promotedBy,
            traceId: null,
            policyHash: lineage.policyHash,
            kind: "POLICY_PROMOTED",
            payload: {
              parentPolicyHash: lineage.parentPolicyHash,
              promotedBy: lineage.promotedBy,
              rationale: lineage.rationale,
              acceptedRiskScore: lineage.acceptedRiskScore,
              source: lineage.source,
              drift: lineage.drift
            },
            parentEventId: null
          })
        ]
      : [];

  const events = [...runEvents, ...resultEvents, ...outcomeEvents, ...guardrailEvents, ...approvalEvents, ...promotionEvents];
  return events.sort(sortEvents);
}

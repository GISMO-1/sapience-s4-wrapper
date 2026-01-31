import { randomUUID } from "node:crypto";
import { config } from "../config";
import type { IntentApprovalInput, IntentApprovalRecord, IntentApprovalStore } from "./types";
import { PostgresIntentApprovalStore } from "./store.pg";

function sortApprovals(a: IntentApprovalRecord, b: IntentApprovalRecord): number {
  const timeDiff = a.approvedAt.getTime() - b.approvedAt.getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return a.id.localeCompare(b.id);
}

export class InMemoryIntentApprovalStore implements IntentApprovalStore {
  private readonly approvals: IntentApprovalRecord[] = [];

  async recordApproval(input: IntentApprovalInput): Promise<IntentApprovalRecord> {
    const existing = this.approvals.find(
      (approval) =>
        approval.traceId === input.traceId &&
        approval.requiredRole === input.requiredRole &&
        approval.actor === input.actor &&
        approval.policyHash === input.policyHash &&
        approval.decisionId === input.decisionId
    );
    if (existing) {
      return existing;
    }
    const record: IntentApprovalRecord = {
      id: randomUUID(),
      traceId: input.traceId,
      intentId: input.intentId,
      policyHash: input.policyHash,
      decisionId: input.decisionId,
      requiredRole: input.requiredRole,
      actor: input.actor,
      rationale: input.rationale,
      approvedAt: input.approvedAt ?? new Date()
    };
    this.approvals.push(record);
    return record;
  }

  async listApprovalsByTraceId(traceId: string): Promise<IntentApprovalRecord[]> {
    return this.approvals.filter((approval) => approval.traceId === traceId).sort(sortApprovals);
  }
}

class FallbackIntentApprovalStore implements IntentApprovalStore {
  constructor(
    private readonly primary: IntentApprovalStore,
    private readonly fallback: IntentApprovalStore
  ) {}

  async recordApproval(input: IntentApprovalInput): Promise<IntentApprovalRecord> {
    try {
      return await this.primary.recordApproval(input);
    } catch (error) {
      return this.fallback.recordApproval(input);
    }
  }

  async listApprovalsByTraceId(traceId: string): Promise<IntentApprovalRecord[]> {
    try {
      return await this.primary.listApprovalsByTraceId(traceId);
    } catch (error) {
      return this.fallback.listApprovalsByTraceId(traceId);
    }
  }
}

export function createIntentApprovalStore(): IntentApprovalStore {
  if (config.useInMemoryStore) {
    return new InMemoryIntentApprovalStore();
  }
  const memoryStore = new InMemoryIntentApprovalStore();
  return new FallbackIntentApprovalStore(new PostgresIntentApprovalStore(), memoryStore);
}

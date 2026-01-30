import type { PolicyDecisionResult } from "./policy-types";

export type PolicyRecord = PolicyDecisionResult & {
  traceId: string;
  evaluatedAt: string;
};

export interface PolicyStore {
  savePolicy(traceId: string, decision: PolicyDecisionResult): Promise<PolicyRecord>;
  getPolicyByTraceId(traceId: string): Promise<PolicyRecord | null>;
}

export class InMemoryPolicyStore implements PolicyStore {
  private readonly decisions = new Map<string, PolicyRecord>();

  async savePolicy(traceId: string, decision: PolicyDecisionResult): Promise<PolicyRecord> {
    const record: PolicyRecord = {
      traceId,
      decision: decision.decision,
      reasons: decision.reasons,
      evaluatedAt: new Date().toISOString()
    };
    this.decisions.set(traceId, record);
    return record;
  }

  async getPolicyByTraceId(traceId: string): Promise<PolicyRecord | null> {
    return this.decisions.get(traceId) ?? null;
  }
}

export function createPolicyStore(): PolicyStore {
  return new InMemoryPolicyStore();
}

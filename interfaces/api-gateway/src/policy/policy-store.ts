import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { config } from "../config";
import type { PolicyDecisionResult, PolicyReason, RiskAssessment } from "../policy-code/types";
import { generateId, now } from "../testing/determinism";

export type PolicyDecisionRecord = {
  id: string;
  traceId: string;
  policyHash: string;
  decision: PolicyDecisionResult["final"];
  matchedRuleIds: string[];
  reasons: PolicyReason[];
  categories: string[];
  risk: RiskAssessment;
  createdAt: Date;
};

export interface PolicyStore {
  savePolicyDecision: (traceId: string, decision: PolicyDecisionResult) => Promise<PolicyDecisionRecord>;
  getPolicyByTraceId: (traceId: string) => Promise<PolicyDecisionRecord | null>;
}

class InMemoryPolicyStore implements PolicyStore {
  private readonly decisions = new Map<string, PolicyDecisionRecord>();

  async savePolicyDecision(traceId: string, decision: PolicyDecisionResult): Promise<PolicyDecisionRecord> {
    const record: PolicyDecisionRecord = {
      id: generateId(),
      traceId,
      policyHash: decision.policy.hash,
      decision: decision.final,
      matchedRuleIds: decision.matchedRules.map((rule) => rule.ruleId),
      reasons: decision.reasons,
      categories: decision.categories,
      risk: decision.risk,
      createdAt: now()
    };
    this.decisions.set(traceId, record);
    return record;
  }

  async getPolicyByTraceId(traceId: string): Promise<PolicyDecisionRecord | null> {
    return this.decisions.get(traceId) ?? null;
  }
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

class PostgresPolicyStore implements PolicyStore {
  async savePolicyDecision(traceId: string, decision: PolicyDecisionResult): Promise<PolicyDecisionRecord> {
    const record: PolicyDecisionRecord = {
      id: randomUUID(),
      traceId,
      policyHash: decision.policy.hash,
      decision: decision.final,
      matchedRuleIds: decision.matchedRules.map((rule) => rule.ruleId),
      reasons: decision.reasons,
      categories: decision.categories,
      risk: decision.risk,
      createdAt: new Date()
    };

    await pool.query(
      "INSERT INTO policy_decisions (id, trace_id, policy_hash, decision, matched_rule_ids, reasons, categories, risk, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        record.id,
        record.traceId,
        record.policyHash,
        record.decision,
        record.matchedRuleIds,
        JSON.stringify(record.reasons),
        record.categories,
        JSON.stringify(record.risk),
        record.createdAt
      ]
    );

    return record;
  }

  async getPolicyByTraceId(traceId: string): Promise<PolicyDecisionRecord | null> {
    const result = await pool.query(
      "SELECT id, trace_id, policy_hash, decision, matched_rule_ids, reasons, categories, risk, created_at FROM policy_decisions WHERE trace_id = $1 ORDER BY created_at DESC LIMIT 1",
      [traceId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      traceId: row.trace_id,
      policyHash: row.policy_hash,
      decision: row.decision,
      matchedRuleIds: row.matched_rule_ids,
      reasons: row.reasons,
      categories: row.categories,
      risk: row.risk,
      createdAt: row.created_at
    };
  }
}

class FallbackPolicyStore implements PolicyStore {
  constructor(
    private readonly primary: PolicyStore,
    private readonly fallback: PolicyStore
  ) {}

  async savePolicyDecision(traceId: string, decision: PolicyDecisionResult): Promise<PolicyDecisionRecord> {
    try {
      return await this.primary.savePolicyDecision(traceId, decision);
    } catch (error) {
      return this.fallback.savePolicyDecision(traceId, decision);
    }
  }

  async getPolicyByTraceId(traceId: string): Promise<PolicyDecisionRecord | null> {
    try {
      return await this.primary.getPolicyByTraceId(traceId);
    } catch (error) {
      return this.fallback.getPolicyByTraceId(traceId);
    }
  }
}

export function createPolicyStore(): PolicyStore {
  if (config.useInMemoryStore) {
    return new InMemoryPolicyStore();
  }
  const memoryStore = new InMemoryPolicyStore();
  return new FallbackPolicyStore(new PostgresPolicyStore(), memoryStore);
}

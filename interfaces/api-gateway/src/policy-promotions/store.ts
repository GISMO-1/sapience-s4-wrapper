import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { config } from "../config";
import type { PolicyPromotionInput, PolicyPromotionRecord } from "./types";

export type PolicyPromotionStore = {
  createPromotion: (input: PolicyPromotionInput) => Promise<PolicyPromotionRecord>;
  listPromotions: (policyHash: string) => Promise<PolicyPromotionRecord[]>;
};

export class InMemoryPolicyPromotionStore implements PolicyPromotionStore {
  private readonly records: PolicyPromotionRecord[] = [];

  async createPromotion(input: PolicyPromotionInput): Promise<PolicyPromotionRecord> {
    const record: PolicyPromotionRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...input
    };
    this.records.push(record);
    return record;
  }

  async listPromotions(policyHash: string): Promise<PolicyPromotionRecord[]> {
    return this.records
      .filter((record) => record.policyHash === policyHash)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

function mapRow(row: any): PolicyPromotionRecord {
  return {
    id: row.id,
    policyHash: row.policy_hash,
    evaluatedAt:
      row.evaluated_at instanceof Date ? row.evaluated_at.toISOString() : new Date(row.evaluated_at).toISOString(),
    reviewer: row.reviewer,
    rationale: row.rationale,
    acceptedRisk: row.accepted_risk_score === null ? null : Number(row.accepted_risk_score),
    forced: row.forced,
    guardrailDecision: row.guardrail_decision,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  };
}

export class PostgresPolicyPromotionStore implements PolicyPromotionStore {
  async createPromotion(input: PolicyPromotionInput): Promise<PolicyPromotionRecord> {
    const id = randomUUID();
    const createdAt = new Date();
    await pool.query(
      `INSERT INTO policy_promotions
       (id, policy_hash, evaluated_at, reviewer, rationale, accepted_risk_score, forced, guardrail_decision, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        input.policyHash,
        input.evaluatedAt,
        input.reviewer,
        input.rationale,
        input.acceptedRisk ?? null,
        input.forced,
        JSON.stringify(input.guardrailDecision),
        createdAt.toISOString()
      ]
    );

    return {
      id,
      createdAt: createdAt.toISOString(),
      ...input
    };
  }

  async listPromotions(policyHash: string): Promise<PolicyPromotionRecord[]> {
    const result = await pool.query(
      `SELECT id, policy_hash, evaluated_at, reviewer, rationale, accepted_risk_score, forced, guardrail_decision, created_at
       FROM policy_promotions
       WHERE policy_hash = $1
       ORDER BY created_at ASC`,
      [policyHash]
    );
    return result.rows.map((row: any) => mapRow(row));
  }
}

class FallbackPolicyPromotionStore implements PolicyPromotionStore {
  constructor(
    private readonly primary: PolicyPromotionStore,
    private readonly fallback: PolicyPromotionStore
  ) {}

  async createPromotion(input: PolicyPromotionInput): Promise<PolicyPromotionRecord> {
    try {
      return await this.primary.createPromotion(input);
    } catch (error) {
      return this.fallback.createPromotion(input);
    }
  }

  async listPromotions(policyHash: string): Promise<PolicyPromotionRecord[]> {
    try {
      return await this.primary.listPromotions(policyHash);
    } catch (error) {
      return this.fallback.listPromotions(policyHash);
    }
  }
}

export function createPolicyPromotionStore(): PolicyPromotionStore {
  if (config.useInMemoryStore) {
    return new InMemoryPolicyPromotionStore();
  }
  const memoryStore = new InMemoryPolicyPromotionStore();
  return new FallbackPolicyPromotionStore(new PostgresPolicyPromotionStore(), memoryStore);
}

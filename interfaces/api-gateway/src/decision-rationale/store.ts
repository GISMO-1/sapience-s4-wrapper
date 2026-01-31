import { Pool } from "pg";
import { config } from "../config";
import type { DecisionRationale } from "./types";

export type DecisionRationaleStore = {
  recordDecisionRationale: (rationale: DecisionRationale) => Promise<DecisionRationale>;
  getDecisionRationaleById: (decisionId: string) => Promise<DecisionRationale | null>;
  listDecisionRationalesByTraceId: (traceId: string) => Promise<DecisionRationale[]>;
  listDecisionRationalesByPolicyHash: (policyHash: string) => Promise<DecisionRationale[]>;
};

function sortRationales(a: DecisionRationale, b: DecisionRationale): number {
  if (a.timestamps.decidedAt !== b.timestamps.decidedAt) {
    return a.timestamps.decidedAt.localeCompare(b.timestamps.decidedAt);
  }
  return a.decisionId.localeCompare(b.decisionId);
}

export class InMemoryDecisionRationaleStore implements DecisionRationaleStore {
  private readonly records = new Map<string, DecisionRationale>();

  async recordDecisionRationale(rationale: DecisionRationale): Promise<DecisionRationale> {
    if (!this.records.has(rationale.decisionId)) {
      this.records.set(rationale.decisionId, rationale);
    }
    return this.records.get(rationale.decisionId) as DecisionRationale;
  }

  async getDecisionRationaleById(decisionId: string): Promise<DecisionRationale | null> {
    return this.records.get(decisionId) ?? null;
  }

  async listDecisionRationalesByTraceId(traceId: string): Promise<DecisionRationale[]> {
    return Array.from(this.records.values())
      .filter((record) => record.traceId === traceId)
      .sort(sortRationales);
  }

  async listDecisionRationalesByPolicyHash(policyHash: string): Promise<DecisionRationale[]> {
    return Array.from(this.records.values())
      .filter((record) => record.policyHash === policyHash)
      .sort(sortRationales);
  }
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

function mapRow(row: any): DecisionRationale {
  return {
    decisionId: row.decision_id,
    traceId: row.trace_id,
    policyHash: row.policy_hash,
    decisionType: row.decision_type,
    outcome: row.outcome,
    confidenceScore: Number(row.confidence_score),
    rationaleBlocks: row.rationale_blocks,
    rejectedAlternatives: row.rejected_alternatives,
    acceptedRisk: row.accepted_risk,
    timestamps: row.timestamps
  };
}

export class PostgresDecisionRationaleStore implements DecisionRationaleStore {
  async recordDecisionRationale(rationale: DecisionRationale): Promise<DecisionRationale> {
    await pool.query(
      `INSERT INTO decision_rationales
       (decision_id, trace_id, policy_hash, decision_type, outcome, confidence_score, rationale_blocks, rejected_alternatives, accepted_risk, timestamps, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (decision_id) DO NOTHING`,
      [
        rationale.decisionId,
        rationale.traceId,
        rationale.policyHash,
        rationale.decisionType,
        rationale.outcome,
        rationale.confidenceScore,
        JSON.stringify(rationale.rationaleBlocks),
        JSON.stringify(rationale.rejectedAlternatives),
        JSON.stringify(rationale.acceptedRisk),
        JSON.stringify(rationale.timestamps),
        new Date().toISOString()
      ]
    );
    return rationale;
  }

  async getDecisionRationaleById(decisionId: string): Promise<DecisionRationale | null> {
    const result = await pool.query(
      `SELECT decision_id, trace_id, policy_hash, decision_type, outcome, confidence_score,
              rationale_blocks, rejected_alternatives, accepted_risk, timestamps
       FROM decision_rationales
       WHERE decision_id = $1`,
      [decisionId]
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async listDecisionRationalesByTraceId(traceId: string): Promise<DecisionRationale[]> {
    const result = await pool.query(
      `SELECT decision_id, trace_id, policy_hash, decision_type, outcome, confidence_score,
              rationale_blocks, rejected_alternatives, accepted_risk, timestamps
       FROM decision_rationales
       WHERE trace_id = $1
       ORDER BY (timestamps->>'decidedAt') ASC, decision_id ASC`,
      [traceId]
    );
    return result.rows.map((row: any) => mapRow(row));
  }

  async listDecisionRationalesByPolicyHash(policyHash: string): Promise<DecisionRationale[]> {
    const result = await pool.query(
      `SELECT decision_id, trace_id, policy_hash, decision_type, outcome, confidence_score,
              rationale_blocks, rejected_alternatives, accepted_risk, timestamps
       FROM decision_rationales
       WHERE policy_hash = $1
       ORDER BY (timestamps->>'decidedAt') ASC, decision_id ASC`,
      [policyHash]
    );
    return result.rows.map((row: any) => mapRow(row));
  }
}

class FallbackDecisionRationaleStore implements DecisionRationaleStore {
  constructor(
    private readonly primary: DecisionRationaleStore,
    private readonly fallback: DecisionRationaleStore
  ) {}

  async recordDecisionRationale(rationale: DecisionRationale): Promise<DecisionRationale> {
    try {
      return await this.primary.recordDecisionRationale(rationale);
    } catch (error) {
      return this.fallback.recordDecisionRationale(rationale);
    }
  }

  async getDecisionRationaleById(decisionId: string): Promise<DecisionRationale | null> {
    try {
      return await this.primary.getDecisionRationaleById(decisionId);
    } catch (error) {
      return this.fallback.getDecisionRationaleById(decisionId);
    }
  }

  async listDecisionRationalesByTraceId(traceId: string): Promise<DecisionRationale[]> {
    try {
      return await this.primary.listDecisionRationalesByTraceId(traceId);
    } catch (error) {
      return this.fallback.listDecisionRationalesByTraceId(traceId);
    }
  }

  async listDecisionRationalesByPolicyHash(policyHash: string): Promise<DecisionRationale[]> {
    try {
      return await this.primary.listDecisionRationalesByPolicyHash(policyHash);
    } catch (error) {
      return this.fallback.listDecisionRationalesByPolicyHash(policyHash);
    }
  }
}

export function createDecisionRationaleStore(): DecisionRationaleStore {
  if (config.useInMemoryStore) {
    return new InMemoryDecisionRationaleStore();
  }
  const memoryStore = new InMemoryDecisionRationaleStore();
  return new FallbackDecisionRationaleStore(new PostgresDecisionRationaleStore(), memoryStore);
}

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { config } from "../config";
import type { GuardrailCheckInput, GuardrailCheckRecord } from "./types";
import { generateId, now } from "../testing/determinism";

export type GuardrailCheckStore = {
  recordCheck: (input: GuardrailCheckInput) => Promise<GuardrailCheckRecord>;
  listChecks: (policyHash: string) => Promise<GuardrailCheckRecord[]>;
};

export class InMemoryGuardrailCheckStore implements GuardrailCheckStore {
  private readonly records: GuardrailCheckRecord[] = [];

  async recordCheck(input: GuardrailCheckInput): Promise<GuardrailCheckRecord> {
    const record: GuardrailCheckRecord = {
      id: generateId(),
      createdAt: now().toISOString(),
      ...input
    };
    this.records.push(record);
    return record;
  }

  async listChecks(policyHash: string): Promise<GuardrailCheckRecord[]> {
    return this.records
      .filter((record) => record.policyHash === policyHash)
      .slice()
      .sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt));
  }
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

function mapRow(row: any): GuardrailCheckRecord {
  return {
    id: row.id,
    policyHash: row.policy_hash,
    evaluatedAt:
      row.evaluated_at instanceof Date ? row.evaluated_at.toISOString() : new Date(row.evaluated_at).toISOString(),
    actor: row.actor,
    rationale: row.rationale,
    decision: row.guardrail_decision,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  };
}

export class PostgresGuardrailCheckStore implements GuardrailCheckStore {
  async recordCheck(input: GuardrailCheckInput): Promise<GuardrailCheckRecord> {
    const id = randomUUID();
    const createdAt = new Date();
    await pool.query(
      `INSERT INTO policy_guardrail_checks
       (id, policy_hash, evaluated_at, actor, rationale, guardrail_decision, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        input.policyHash,
        input.evaluatedAt,
        input.actor,
        input.rationale,
        JSON.stringify(input.decision),
        createdAt.toISOString()
      ]
    );

    return {
      id,
      createdAt: createdAt.toISOString(),
      ...input
    };
  }

  async listChecks(policyHash: string): Promise<GuardrailCheckRecord[]> {
    const result = await pool.query(
      `SELECT id, policy_hash, evaluated_at, actor, rationale, guardrail_decision, created_at
       FROM policy_guardrail_checks
       WHERE policy_hash = $1
       ORDER BY evaluated_at ASC`,
      [policyHash]
    );
    return result.rows.map((row: any) => mapRow(row));
  }
}

class FallbackGuardrailCheckStore implements GuardrailCheckStore {
  constructor(
    private readonly primary: GuardrailCheckStore,
    private readonly fallback: GuardrailCheckStore
  ) {}

  async recordCheck(input: GuardrailCheckInput): Promise<GuardrailCheckRecord> {
    try {
      return await this.primary.recordCheck(input);
    } catch (error) {
      return this.fallback.recordCheck(input);
    }
  }

  async listChecks(policyHash: string): Promise<GuardrailCheckRecord[]> {
    try {
      return await this.primary.listChecks(policyHash);
    } catch (error) {
      return this.fallback.listChecks(policyHash);
    }
  }
}

export function createPolicyGuardrailCheckStore(): GuardrailCheckStore {
  if (config.useInMemoryStore) {
    return new InMemoryGuardrailCheckStore();
  }
  const memoryStore = new InMemoryGuardrailCheckStore();
  return new FallbackGuardrailCheckStore(new PostgresGuardrailCheckStore(), memoryStore);
}

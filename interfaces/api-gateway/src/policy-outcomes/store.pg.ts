import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { config } from "../config";
import type { PolicyOutcomeFilters, PolicyOutcomeInput, PolicyOutcomeRecord } from "./types";

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

function toDate(value: any): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function mapRow(row: any): PolicyOutcomeRecord {
  return {
    id: row.id,
    traceId: row.trace_id,
    intentType: row.intent_type,
    policyHash: row.policy_hash,
    decision: row.decision,
    outcomeType: row.outcome_type,
    severity: Number(row.severity),
    humanOverride: row.human_override,
    notes: row.notes,
    observedAt: toDate(row.observed_at),
    createdAt: toDate(row.created_at)
  };
}

export class PostgresPolicyOutcomeStore {
  async recordOutcome(input: PolicyOutcomeInput): Promise<PolicyOutcomeRecord> {
    const record: PolicyOutcomeRecord = {
      id: randomUUID(),
      traceId: input.traceId,
      intentType: input.intentType,
      policyHash: input.policyHash,
      decision: input.decision,
      outcomeType: input.outcomeType,
      severity: input.severity,
      humanOverride: input.humanOverride,
      notes: input.notes ?? null,
      observedAt: input.observedAt ?? new Date(),
      createdAt: new Date()
    };

    await pool.query(
      `INSERT INTO policy_outcomes
       (id, trace_id, intent_type, policy_hash, decision, outcome_type, severity, human_override, notes, observed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        record.id,
        record.traceId,
        record.intentType,
        record.policyHash,
        record.decision,
        record.outcomeType,
        record.severity,
        record.humanOverride,
        record.notes,
        record.observedAt,
        record.createdAt
      ]
    );

    return record;
  }

  async getOutcomesByTraceId(traceId: string): Promise<PolicyOutcomeRecord[]> {
    const result = await pool.query(
      `SELECT id, trace_id, intent_type, policy_hash, decision, outcome_type, severity, human_override, notes, observed_at, created_at
       FROM policy_outcomes
       WHERE trace_id = $1
       ORDER BY observed_at ASC, id ASC`,
      [traceId]
    );
    return result.rows.map((row: any) => mapRow(row));
  }

  async listOutcomes(filters?: PolicyOutcomeFilters): Promise<PolicyOutcomeRecord[]> {
    const clauses: string[] = [];
    const values: Array<string | number | Date> = [];

    if (filters?.policyHash) {
      values.push(filters.policyHash);
      clauses.push(`policy_hash = $${values.length}`);
    }
    if (filters?.since) {
      values.push(filters.since);
      clauses.push(`observed_at >= $${values.length}`);
    }
    if (filters?.until) {
      values.push(filters.until);
      clauses.push(`observed_at <= $${values.length}`);
    }

    let query =
      "SELECT id, trace_id, intent_type, policy_hash, decision, outcome_type, severity, human_override, notes, observed_at, created_at FROM policy_outcomes";
    if (clauses.length) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }
    query += " ORDER BY observed_at ASC, id ASC";

    if (filters?.limit) {
      values.push(filters.limit);
      query += ` LIMIT $${values.length}`;
    }

    const result = await pool.query(query, values);
    return result.rows.map((row: any) => mapRow(row));
  }
}

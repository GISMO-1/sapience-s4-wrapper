import { Pool } from "pg";
import { config } from "../config";
import type { RollbackEvent } from "./types";
import type { PolicyRollbackFilters, PolicyRollbackStore } from "./store";

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

function mapRow(row: any): RollbackEvent {
  return {
    eventType: "ROLLBACK",
    eventHash: row.event_hash,
    fromPolicyHash: row.from_policy_hash,
    toPolicyHash: row.to_policy_hash,
    actor: row.actor,
    rationale: row.rationale,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  };
}

export class PostgresPolicyRollbackStore implements PolicyRollbackStore {
  async recordRollback(event: RollbackEvent): Promise<RollbackEvent> {
    await pool.query(
      `INSERT INTO policy_rollbacks
       (event_hash, from_policy_hash, to_policy_hash, actor, rationale, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (event_hash) DO NOTHING`,
      [
        event.eventHash,
        event.fromPolicyHash,
        event.toPolicyHash,
        event.actor,
        event.rationale,
        event.createdAt
      ]
    );

    return event;
  }

  async listRollbacks(filters?: PolicyRollbackFilters): Promise<RollbackEvent[]> {
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (filters?.policyHash) {
      values.push(filters.policyHash);
      clauses.push(`(from_policy_hash = $${values.length} OR to_policy_hash = $${values.length})`);
    }
    if (filters?.fromPolicyHash) {
      values.push(filters.fromPolicyHash);
      clauses.push(`from_policy_hash = $${values.length}`);
    }
    if (filters?.toPolicyHash) {
      values.push(filters.toPolicyHash);
      clauses.push(`to_policy_hash = $${values.length}`);
    }
    if (filters?.since) {
      values.push(filters.since.toISOString());
      clauses.push(`created_at >= $${values.length}`);
    }
    if (filters?.until) {
      values.push(filters.until.toISOString());
      clauses.push(`created_at <= $${values.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitClause = filters?.limit ? `LIMIT ${Number(filters.limit)}` : "";

    const result = await pool.query(
      `SELECT event_hash, from_policy_hash, to_policy_hash, actor, rationale, created_at
       FROM policy_rollbacks
       ${where}
       ORDER BY created_at ASC, event_hash ASC
       ${limitClause}`,
      values
    );

    return result.rows.map((row: any) => mapRow(row));
  }
}

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { config } from "../config";
import type { IntentApprovalInput, IntentApprovalRecord } from "./types";

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

function mapRow(row: any): IntentApprovalRecord {
  return {
    id: row.id,
    traceId: row.trace_id,
    intentId: row.intent_id,
    policyHash: row.policy_hash,
    decisionId: row.decision_id,
    requiredRole: row.required_role,
    actor: row.actor,
    rationale: row.rationale,
    approvedAt: toDate(row.approved_at)
  };
}

export class PostgresIntentApprovalStore {
  async recordApproval(input: IntentApprovalInput): Promise<IntentApprovalRecord> {
    const existing = await pool.query(
      `SELECT id, trace_id, intent_id, policy_hash, decision_id, required_role, actor, rationale, approved_at
       FROM intent_approvals
       WHERE trace_id = $1 AND required_role = $2 AND actor = $3 AND policy_hash = $4 AND decision_id = $5
       ORDER BY approved_at DESC, id DESC
       LIMIT 1`,
      [input.traceId, input.requiredRole, input.actor, input.policyHash, input.decisionId]
    );
    if (existing.rows.length > 0) {
      return mapRow(existing.rows[0]);
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

    await pool.query(
      `INSERT INTO intent_approvals
       (id, trace_id, intent_id, policy_hash, decision_id, required_role, actor, rationale, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        record.id,
        record.traceId,
        record.intentId,
        record.policyHash,
        record.decisionId,
        record.requiredRole,
        record.actor,
        record.rationale,
        record.approvedAt
      ]
    );

    return record;
  }

  async listApprovalsByTraceId(traceId: string): Promise<IntentApprovalRecord[]> {
    const result = await pool.query(
      `SELECT id, trace_id, intent_id, policy_hash, decision_id, required_role, actor, rationale, approved_at
       FROM intent_approvals
       WHERE trace_id = $1
       ORDER BY approved_at ASC, id ASC`,
      [traceId]
    );
    return result.rows.map((row: any) => mapRow(row));
  }
}

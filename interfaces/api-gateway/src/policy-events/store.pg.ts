import { Pool } from "pg";
import { config } from "../config";
import type { PolicyEvent } from "./types";

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

function mapRow(row: any): PolicyEvent {
  return {
    eventId: row.event_id,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString(),
    actor: row.actor,
    traceId: row.trace_id,
    policyHash: row.policy_hash,
    kind: row.kind,
    payload: row.payload_json,
    parentEventId: row.parent_event_id,
    eventHash: row.event_hash
  } as PolicyEvent;
}

export class PostgresPolicyEventStore {
  async appendEvents(events: PolicyEvent[]): Promise<void> {
    if (!events.length) {
      return;
    }

    const values: unknown[] = [];
    const rows: string[] = [];
    events.forEach((event, index) => {
      const base = index * 9;
      rows.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`
      );
      values.push(
        event.eventId,
        event.occurredAt,
        event.actor,
        event.traceId,
        event.policyHash,
        event.kind,
        JSON.stringify(event.payload),
        event.parentEventId,
        event.eventHash
      );
    });

    await pool.query(
      `INSERT INTO policy_events
       (event_id, occurred_at, actor, trace_id, policy_hash, kind, payload_json, parent_event_id, event_hash)
       VALUES ${rows.join(",")}
       ON CONFLICT (event_id) DO NOTHING`,
      values
    );
  }

  async listEvents(filters?: {
    policyHash?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<PolicyEvent[]> {
    const values: Array<string | Date | number> = [];
    const where: string[] = [];

    if (filters?.policyHash) {
      values.push(filters.policyHash);
      where.push(`policy_hash = $${values.length}`);
    }
    if (filters?.since) {
      values.push(filters.since);
      where.push(`occurred_at >= $${values.length}`);
    }
    if (filters?.until) {
      values.push(filters.until);
      where.push(`occurred_at <= $${values.length}`);
    }

    const limit = filters?.limit ?? 200;
    values.push(limit);
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT event_id, occurred_at, actor, trace_id, policy_hash, kind, payload_json, parent_event_id, event_hash
       FROM policy_events
       ${whereClause}
       ORDER BY occurred_at ASC, kind ASC, event_id ASC
       LIMIT $${values.length}`,
      values
    );

    return result.rows.map((row: any) => mapRow(row));
  }
}

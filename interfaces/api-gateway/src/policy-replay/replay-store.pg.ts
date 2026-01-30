import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { config } from "../config";
import type {
  ReplayBaselineIntent,
  ReplayFilters,
  ReplayResultRecord,
  ReplayRunInput,
  ReplayRunRecord,
  ReplayTotals
} from "./types";

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

const DEFAULT_LIMIT = 100;

function buildFilters(filters: ReplayFilters): {
  where: string[];
  values: Array<string | string[] | number | Date>;
} {
  const where: string[] = [];
  const values: Array<string | string[] | number | Date> = [];

  if (filters.intentTypes?.length) {
    values.push(filters.intentTypes);
    where.push(`i.intent_type = ANY($${values.length})`);
  }
  if (filters.since) {
    values.push(filters.since);
    where.push(`i.created_at >= $${values.length}`);
  }
  if (filters.until) {
    values.push(filters.until);
    where.push(`i.created_at <= $${values.length}`);
  }

  return { where, values };
}

export class PostgresPolicyReplayStore {
  async listBaselineIntents(filters: ReplayFilters): Promise<ReplayBaselineIntent[]> {
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const { where, values } = buildFilters(filters);
    values.push(limit);
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT i.trace_id,
              i.intent_type,
              i.parsed_json,
              i.created_at,
              p.decision,
              p.matched_rule_ids,
              p.policy_hash
       FROM intents i
       JOIN LATERAL (
         SELECT decision, matched_rule_ids, policy_hash
         FROM policy_decisions pd
         WHERE pd.trace_id = i.trace_id
         ORDER BY pd.created_at DESC
         LIMIT 1
       ) p ON true
       ${whereClause}
       ORDER BY i.created_at ASC, i.trace_id ASC
       LIMIT $${values.length}`,
      values
    );

    return result.rows.map((row) => ({
      traceId: row.trace_id,
      intentType: row.intent_type,
      intent: row.parsed_json,
      createdAt: row.created_at,
      baselineDecision: row.decision,
      baselineMatchedRules: row.matched_rule_ids,
      baselinePolicyHash: row.policy_hash
    }));
  }

  async createRun(input: ReplayRunInput): Promise<ReplayRunRecord> {
    const record: ReplayRunRecord = {
      id: randomUUID(),
      requestedBy: input.requestedBy ?? null,
      baselinePolicyHash: input.baselinePolicyHash,
      candidatePolicyHash: input.candidatePolicyHash,
      candidatePolicySource: input.candidatePolicySource,
      candidatePolicyRef: input.candidatePolicyRef ?? null,
      intentTypeFilter: input.intentTypeFilter ?? null,
      since: input.since ?? null,
      until: input.until ?? null,
      limit: input.limit,
      createdAt: new Date()
    };

    await pool.query(
      `INSERT INTO policy_replay_runs
       (id, requested_by, baseline_policy_hash, candidate_policy_hash, candidate_policy_source, candidate_policy_ref, intent_type_filter, since, until, "limit", created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        record.id,
        record.requestedBy,
        record.baselinePolicyHash,
        record.candidatePolicyHash,
        record.candidatePolicySource,
        record.candidatePolicyRef,
        record.intentTypeFilter,
        record.since,
        record.until,
        record.limit,
        record.createdAt
      ]
    );

    return record;
  }

  async saveResults(runId: string, results: ReplayResultRecord[]): Promise<void> {
    if (!results.length) {
      return;
    }
    const values: unknown[] = [];
    const rows: string[] = [];

    results.forEach((result, index) => {
      const base = index * 15;
      rows.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14},$${base + 15})`
      );
      values.push(
        result.id,
        runId,
        result.traceId,
        result.intentType,
        result.baselineDecision,
        result.candidateDecision,
        result.changed,
        result.baselinePolicyHash,
        result.candidatePolicyHash,
        result.baselineMatchedRules,
        result.candidateMatchedRules,
        result.candidateConstraintTypes,
        JSON.stringify(result.reasons),
        result.categories,
        JSON.stringify(result.risk)
      );
    });

    await pool.query(
      `INSERT INTO policy_replay_results
       (id, run_id, trace_id, intent_type, baseline_decision, candidate_decision, changed, baseline_policy_hash, candidate_policy_hash, baseline_matched_rules, candidate_matched_rules, candidate_constraint_types, reasons, categories, risk)
       VALUES ${rows.join(",")}`,
      values
    );
  }

  async getRun(runId: string): Promise<ReplayRunRecord | null> {
    const result = await pool.query(
      `SELECT id, requested_by, baseline_policy_hash, candidate_policy_hash, candidate_policy_source, candidate_policy_ref, intent_type_filter, since, until, "limit", created_at
       FROM policy_replay_runs
       WHERE id = $1`,
      [runId]
    );
    if (!result.rows.length) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      requestedBy: row.requested_by,
      baselinePolicyHash: row.baseline_policy_hash,
      candidatePolicyHash: row.candidate_policy_hash,
      candidatePolicySource: row.candidate_policy_source,
      candidatePolicyRef: row.candidate_policy_ref,
      intentTypeFilter: row.intent_type_filter,
      since: row.since,
      until: row.until,
      limit: row.limit,
      createdAt: row.created_at
    };
  }

  async getResults(runId: string, options?: { changed?: boolean; limit?: number; offset?: number }): Promise<ReplayResultRecord[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const values: Array<string | number | boolean> = [runId];
    const where = ["run_id = $1"];
    if (typeof options?.changed === "boolean") {
      values.push(options.changed);
      where.push(`changed = $${values.length}`);
    }
    values.push(limit);
    values.push(offset);

    const result = await pool.query(
      `SELECT id, run_id, trace_id, intent_type, baseline_decision, candidate_decision, changed, baseline_policy_hash, candidate_policy_hash, baseline_matched_rules, candidate_matched_rules, candidate_constraint_types, reasons, categories, risk, created_at
       FROM policy_replay_results
       WHERE ${where.join(" AND ")}
       ORDER BY created_at ASC, trace_id ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return result.rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      traceId: row.trace_id,
      intentType: row.intent_type,
      baselineDecision: row.baseline_decision,
      candidateDecision: row.candidate_decision,
      changed: row.changed,
      baselinePolicyHash: row.baseline_policy_hash,
      candidatePolicyHash: row.candidate_policy_hash,
      baselineMatchedRules: row.baseline_matched_rules,
      candidateMatchedRules: row.candidate_matched_rules,
      candidateConstraintTypes: row.candidate_constraint_types ?? [],
      reasons: row.reasons,
      categories: row.categories,
      risk: row.risk,
      createdAt: row.created_at
    }));
  }

  async getRunTotals(runId: string): Promise<ReplayTotals> {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS count,
         SUM(CASE WHEN changed THEN 1 ELSE 0 END)::int AS changed,
         SUM(CASE WHEN candidate_decision = 'ALLOW' THEN 1 ELSE 0 END)::int AS allow,
         SUM(CASE WHEN candidate_decision = 'WARN' THEN 1 ELSE 0 END)::int AS warn,
         SUM(CASE WHEN candidate_decision = 'DENY' THEN 1 ELSE 0 END)::int AS deny
       FROM policy_replay_results
       WHERE run_id = $1`,
      [runId]
    );

    const row = result.rows[0];
    return {
      count: row?.count ?? 0,
      changed: row?.changed ?? 0,
      allow: row?.allow ?? 0,
      warn: row?.warn ?? 0,
      deny: row?.deny ?? 0
    };
  }
}

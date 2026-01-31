import { Pool } from "pg";
import { config } from "../config";
import type { PolicyLineageInput, PolicyLineageRecord } from "./types";

export type PolicyLineageStore = {
  createLineage: (input: PolicyLineageInput) => Promise<PolicyLineageRecord>;
  getLineage: (policyHash: string) => Promise<PolicyLineageRecord | null>;
  getLineageChain: (policyHash: string) => Promise<PolicyLineageRecord[]>;
  listLineages: () => Promise<PolicyLineageRecord[]>;
};

export class InMemoryPolicyLineageStore implements PolicyLineageStore {
  private readonly records = new Map<string, PolicyLineageRecord>();

  async createLineage(input: PolicyLineageInput): Promise<PolicyLineageRecord> {
    const record: PolicyLineageRecord = { ...input };
    this.records.set(record.policyHash, record);
    return record;
  }

  async getLineage(policyHash: string): Promise<PolicyLineageRecord | null> {
    return this.records.get(policyHash) ?? null;
  }

  async getLineageChain(policyHash: string): Promise<PolicyLineageRecord[]> {
    const chain: PolicyLineageRecord[] = [];
    const seen = new Set<string>();
    let currentHash: string | null = policyHash;

    while (currentHash && !seen.has(currentHash)) {
      seen.add(currentHash);
      const record = this.records.get(currentHash);
      if (!record) {
        break;
      }
      chain.push(record);
      currentHash = record.parentPolicyHash;
    }

    return chain;
  }

  async listLineages(): Promise<PolicyLineageRecord[]> {
    return Array.from(this.records.values()).sort((a, b) => {
      if (a.promotedAt !== b.promotedAt) {
        return a.promotedAt.localeCompare(b.promotedAt);
      }
      return a.policyHash.localeCompare(b.policyHash);
    });
  }
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

function mapRow(row: any): PolicyLineageRecord {
  const promotedAt =
    row.promoted_at instanceof Date ? row.promoted_at.toISOString() : new Date(row.promoted_at).toISOString();
  return {
    policyHash: row.policy_hash,
    parentPolicyHash: row.parent_policy_hash,
    promotedBy: row.promoted_by,
    promotedAt,
    rationale: row.rationale,
    acceptedRiskScore: Number(row.accepted_risk_score),
    source: row.source,
    drift: {
      constraintsAdded: row.constraints_added,
      constraintsRemoved: row.constraints_removed,
      severityDelta: row.severity_delta,
      netRiskScoreChange: row.net_risk_score_change
    }
  };
}

export class PostgresPolicyLineageStore implements PolicyLineageStore {
  async createLineage(input: PolicyLineageInput): Promise<PolicyLineageRecord> {
    await pool.query(
      `INSERT INTO policy_lineage
       (policy_hash, parent_policy_hash, promoted_by, promoted_at, rationale, accepted_risk_score, source, constraints_added, constraints_removed, severity_delta, net_risk_score_change)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (policy_hash) DO UPDATE SET
         parent_policy_hash = EXCLUDED.parent_policy_hash,
         promoted_by = EXCLUDED.promoted_by,
         promoted_at = EXCLUDED.promoted_at,
         rationale = EXCLUDED.rationale,
         accepted_risk_score = EXCLUDED.accepted_risk_score,
         source = EXCLUDED.source,
         constraints_added = EXCLUDED.constraints_added,
         constraints_removed = EXCLUDED.constraints_removed,
         severity_delta = EXCLUDED.severity_delta,
         net_risk_score_change = EXCLUDED.net_risk_score_change`,
      [
        input.policyHash,
        input.parentPolicyHash,
        input.promotedBy,
        input.promotedAt,
        input.rationale,
        input.acceptedRiskScore,
        input.source,
        input.drift.constraintsAdded,
        input.drift.constraintsRemoved,
        input.drift.severityDelta,
        input.drift.netRiskScoreChange
      ]
    );

    return { ...input };
  }

  async getLineage(policyHash: string): Promise<PolicyLineageRecord | null> {
    const result = await pool.query(
      `SELECT policy_hash, parent_policy_hash, promoted_by, promoted_at, rationale, accepted_risk_score, source,
              constraints_added, constraints_removed, severity_delta, net_risk_score_change
       FROM policy_lineage
       WHERE policy_hash = $1`,
      [policyHash]
    );
    if (!result.rows.length) {
      return null;
    }
    return mapRow(result.rows[0]);
  }

  async getLineageChain(policyHash: string): Promise<PolicyLineageRecord[]> {
    const result = await pool.query(
      `WITH RECURSIVE lineage AS (
         SELECT policy_hash, parent_policy_hash, promoted_by, promoted_at, rationale, accepted_risk_score, source,
                constraints_added, constraints_removed, severity_delta, net_risk_score_change, 0 AS depth
         FROM policy_lineage
         WHERE policy_hash = $1
         UNION ALL
         SELECT pl.policy_hash, pl.parent_policy_hash, pl.promoted_by, pl.promoted_at, pl.rationale, pl.accepted_risk_score,
                pl.source, pl.constraints_added, pl.constraints_removed, pl.severity_delta, pl.net_risk_score_change, lineage.depth + 1
         FROM policy_lineage pl
         JOIN lineage ON pl.policy_hash = lineage.parent_policy_hash
       )
       SELECT policy_hash, parent_policy_hash, promoted_by, promoted_at, rationale, accepted_risk_score, source,
              constraints_added, constraints_removed, severity_delta, net_risk_score_change
       FROM lineage
       ORDER BY depth ASC`,
      [policyHash]
    );
    return result.rows.map((row: any) => mapRow(row));
  }

  async listLineages(): Promise<PolicyLineageRecord[]> {
    const result = await pool.query(
      `SELECT policy_hash, parent_policy_hash, promoted_by, promoted_at, rationale, accepted_risk_score, source,
              constraints_added, constraints_removed, severity_delta, net_risk_score_change
       FROM policy_lineage
       ORDER BY promoted_at ASC, policy_hash ASC`
    );
    return result.rows.map((row: any) => mapRow(row));
  }
}

class FallbackPolicyLineageStore implements PolicyLineageStore {
  constructor(
    private readonly primary: PolicyLineageStore,
    private readonly fallback: PolicyLineageStore
  ) {}

  async createLineage(input: PolicyLineageInput): Promise<PolicyLineageRecord> {
    try {
      return await this.primary.createLineage(input);
    } catch (error) {
      return this.fallback.createLineage(input);
    }
  }

  async getLineage(policyHash: string): Promise<PolicyLineageRecord | null> {
    try {
      return await this.primary.getLineage(policyHash);
    } catch (error) {
      return this.fallback.getLineage(policyHash);
    }
  }

  async getLineageChain(policyHash: string): Promise<PolicyLineageRecord[]> {
    try {
      return await this.primary.getLineageChain(policyHash);
    } catch (error) {
      return this.fallback.getLineageChain(policyHash);
    }
  }

  async listLineages(): Promise<PolicyLineageRecord[]> {
    try {
      return await this.primary.listLineages();
    } catch (error) {
      return this.fallback.listLineages();
    }
  }
}

export function createPolicyLineageStore(): PolicyLineageStore {
  if (config.useInMemoryStore) {
    return new InMemoryPolicyLineageStore();
  }
  const memoryStore = new InMemoryPolicyLineageStore();
  return new FallbackPolicyLineageStore(new PostgresPolicyLineageStore(), memoryStore);
}

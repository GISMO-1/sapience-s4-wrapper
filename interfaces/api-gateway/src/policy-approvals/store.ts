import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { config } from "../config";
import type { PolicyApprovalInput, PolicyApprovalRecord } from "./types";
import { generateId, now } from "../testing/determinism";

export type PolicyApprovalStore = {
  recordApproval: (input: PolicyApprovalInput) => Promise<PolicyApprovalRecord>;
  listApprovals: (policyHash: string) => Promise<PolicyApprovalRecord[]>;
};

export class InMemoryPolicyApprovalStore implements PolicyApprovalStore {
  private readonly records: PolicyApprovalRecord[] = [];

  async recordApproval(input: PolicyApprovalInput): Promise<PolicyApprovalRecord> {
    const record: PolicyApprovalRecord = {
      id: generateId(),
      createdAt: now().toISOString(),
      ...input
    };
    this.records.push(record);
    return record;
  }

  async listApprovals(policyHash: string): Promise<PolicyApprovalRecord[]> {
    return this.records
      .filter((record) => record.policyHash === policyHash)
      .slice()
      .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt));
  }
}

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

function mapRow(row: any): PolicyApprovalRecord {
  return {
    id: row.id,
    policyHash: row.policy_hash,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at instanceof Date ? row.approved_at.toISOString() : new Date(row.approved_at).toISOString(),
    rationale: row.rationale,
    acceptedRiskScore: row.accepted_risk_score === null ? null : Number(row.accepted_risk_score),
    notes: row.notes,
    runId: row.run_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
  };
}

export class PostgresPolicyApprovalStore implements PolicyApprovalStore {
  async recordApproval(input: PolicyApprovalInput): Promise<PolicyApprovalRecord> {
    const id = randomUUID();
    const createdAt = new Date();
    await pool.query(
      `INSERT INTO policy_approvals
       (id, policy_hash, approved_by, approved_at, rationale, accepted_risk_score, notes, run_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        input.policyHash,
        input.approvedBy,
        input.approvedAt,
        input.rationale,
        input.acceptedRiskScore ?? null,
        input.notes ?? null,
        input.runId ?? null,
        createdAt.toISOString()
      ]
    );

    return {
      id,
      createdAt: createdAt.toISOString(),
      ...input
    };
  }

  async listApprovals(policyHash: string): Promise<PolicyApprovalRecord[]> {
    const result = await pool.query(
      `SELECT id, policy_hash, approved_by, approved_at, rationale, accepted_risk_score, notes, run_id, created_at
       FROM policy_approvals
       WHERE policy_hash = $1
       ORDER BY approved_at ASC`,
      [policyHash]
    );
    return result.rows.map((row: any) => mapRow(row));
  }
}

class FallbackPolicyApprovalStore implements PolicyApprovalStore {
  constructor(
    private readonly primary: PolicyApprovalStore,
    private readonly fallback: PolicyApprovalStore
  ) {}

  async recordApproval(input: PolicyApprovalInput): Promise<PolicyApprovalRecord> {
    try {
      return await this.primary.recordApproval(input);
    } catch (error) {
      return this.fallback.recordApproval(input);
    }
  }

  async listApprovals(policyHash: string): Promise<PolicyApprovalRecord[]> {
    try {
      return await this.primary.listApprovals(policyHash);
    } catch (error) {
      return this.fallback.listApprovals(policyHash);
    }
  }
}

export function createPolicyApprovalStore(): PolicyApprovalStore {
  if (config.useInMemoryStore) {
    return new InMemoryPolicyApprovalStore();
  }
  const memoryStore = new InMemoryPolicyApprovalStore();
  return new FallbackPolicyApprovalStore(new PostgresPolicyApprovalStore(), memoryStore);
}

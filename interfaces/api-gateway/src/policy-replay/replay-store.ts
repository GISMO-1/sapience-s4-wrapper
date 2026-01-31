import { randomUUID } from "node:crypto";
import { config } from "../config";
import type {
  ReplayBaselineIntent,
  ReplayFilters,
  ReplayResultRecord,
  ReplayRunFilters,
  ReplayRunInput,
  ReplayRunRecord,
  ReplayTotals
} from "./types";
import { PostgresPolicyReplayStore } from "./replay-store.pg";

export interface PolicyReplayStore {
  listBaselineIntents(filters: ReplayFilters): Promise<ReplayBaselineIntent[]>;
  listRuns(filters: ReplayRunFilters): Promise<ReplayRunRecord[]>;
  createRun(input: ReplayRunInput): Promise<ReplayRunRecord>;
  saveResults(runId: string, results: ReplayResultRecord[]): Promise<void>;
  getRun(runId: string): Promise<ReplayRunRecord | null>;
  getResults(runId: string, options?: { changed?: boolean; limit?: number; offset?: number }): Promise<ReplayResultRecord[]>;
  getRunTotals(runId: string): Promise<ReplayTotals>;
}

export class InMemoryPolicyReplayStore implements PolicyReplayStore {
  private readonly baselineIntents: ReplayBaselineIntent[];
  private readonly runs = new Map<string, ReplayRunRecord>();
  private readonly results: ReplayResultRecord[] = [];

  constructor(options?: { baselineIntents?: ReplayBaselineIntent[] }) {
    this.baselineIntents = options?.baselineIntents ?? [];
  }

  async listBaselineIntents(filters: ReplayFilters): Promise<ReplayBaselineIntent[]> {
    const intentTypes = filters.intentTypes;
    const since = filters.since?.getTime();
    const until = filters.until?.getTime();
    const limit = filters.limit ?? 100;

    return this.baselineIntents
      .filter((item) => {
        if (intentTypes?.length && !intentTypes.includes(item.intentType)) {
          return false;
        }
        const created = item.createdAt.getTime();
        if (since && created < since) {
          return false;
        }
        if (until && created > until) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
        if (createdDiff !== 0) {
          return createdDiff;
        }
        return a.traceId.localeCompare(b.traceId);
      })
      .slice(0, limit);
  }

  async listRuns(filters: ReplayRunFilters): Promise<ReplayRunRecord[]> {
    const limit = filters.limit ?? 100;
    const since = filters.since?.getTime();
    const until = filters.until?.getTime();
    return Array.from(this.runs.values())
      .filter((run) => {
        if (filters.policyHash && run.candidatePolicyHash !== filters.policyHash) {
          return false;
        }
        const created = run.createdAt.getTime();
        if (since && created < since) {
          return false;
        }
        if (until && created > until) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
        if (createdDiff !== 0) {
          return createdDiff;
        }
        return a.id.localeCompare(b.id);
      })
      .slice(0, limit);
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
    this.runs.set(record.id, record);
    return record;
  }

  async saveResults(runId: string, results: ReplayResultRecord[]): Promise<void> {
    results.forEach((result) => {
      this.results.push({ ...result, runId });
    });
  }

  async getRun(runId: string): Promise<ReplayRunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async getResults(runId: string, options?: { changed?: boolean; limit?: number; offset?: number }): Promise<ReplayResultRecord[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    return this.results
      .filter((result) => result.runId === runId)
      .filter((result) => (typeof options?.changed === "boolean" ? result.changed === options.changed : true))
      .sort((a, b) => {
        const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
        if (createdDiff !== 0) {
          return createdDiff;
        }
        return a.traceId.localeCompare(b.traceId);
      })
      .slice(offset, offset + limit);
  }

  async getRunTotals(runId: string): Promise<ReplayTotals> {
    const matches = this.results.filter((result) => result.runId === runId);
    return {
      count: matches.length,
      changed: matches.filter((result) => result.changed).length,
      allow: matches.filter((result) => result.candidateDecision === "ALLOW").length,
      warn: matches.filter((result) => result.candidateDecision === "WARN").length,
      deny: matches.filter((result) => result.candidateDecision === "DENY").length
    };
  }
}

class FallbackPolicyReplayStore implements PolicyReplayStore {
  constructor(
    private readonly primary: PolicyReplayStore,
    private readonly fallback: PolicyReplayStore
  ) {}

  async listBaselineIntents(filters: ReplayFilters): Promise<ReplayBaselineIntent[]> {
    try {
      return await this.primary.listBaselineIntents(filters);
    } catch (error) {
      return this.fallback.listBaselineIntents(filters);
    }
  }

  async listRuns(filters: ReplayRunFilters): Promise<ReplayRunRecord[]> {
    try {
      return await this.primary.listRuns(filters);
    } catch (error) {
      return this.fallback.listRuns(filters);
    }
  }

  async createRun(input: ReplayRunInput): Promise<ReplayRunRecord> {
    try {
      return await this.primary.createRun(input);
    } catch (error) {
      return this.fallback.createRun(input);
    }
  }

  async saveResults(runId: string, results: ReplayResultRecord[]): Promise<void> {
    try {
      await this.primary.saveResults(runId, results);
    } catch (error) {
      await this.fallback.saveResults(runId, results);
    }
  }

  async getRun(runId: string): Promise<ReplayRunRecord | null> {
    try {
      return await this.primary.getRun(runId);
    } catch (error) {
      return this.fallback.getRun(runId);
    }
  }

  async getResults(runId: string, options?: { changed?: boolean; limit?: number; offset?: number }): Promise<ReplayResultRecord[]> {
    try {
      return await this.primary.getResults(runId, options);
    } catch (error) {
      return this.fallback.getResults(runId, options);
    }
  }

  async getRunTotals(runId: string): Promise<ReplayTotals> {
    try {
      return await this.primary.getRunTotals(runId);
    } catch (error) {
      return this.fallback.getRunTotals(runId);
    }
  }
}

export function createPolicyReplayStore(): PolicyReplayStore {
  if (config.useInMemoryStore) {
    return new InMemoryPolicyReplayStore();
  }
  const memoryStore = new InMemoryPolicyReplayStore();
  return new FallbackPolicyReplayStore(new PostgresPolicyReplayStore(), memoryStore);
}

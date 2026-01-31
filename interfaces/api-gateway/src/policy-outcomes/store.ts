import { randomUUID } from "node:crypto";
import { config } from "../config";
import type { PolicyOutcomeFilters, PolicyOutcomeInput, PolicyOutcomeRecord } from "./types";
import { PostgresPolicyOutcomeStore } from "./store.pg";

export type PolicyOutcomeStore = {
  recordOutcome: (input: PolicyOutcomeInput) => Promise<PolicyOutcomeRecord>;
  getOutcomesByTraceId: (traceId: string) => Promise<PolicyOutcomeRecord[]>;
  listOutcomes: (filters?: PolicyOutcomeFilters) => Promise<PolicyOutcomeRecord[]>;
};

function sortOutcomes(a: PolicyOutcomeRecord, b: PolicyOutcomeRecord): number {
  const timeDiff = a.observedAt.getTime() - b.observedAt.getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return a.id.localeCompare(b.id);
}

export class InMemoryPolicyOutcomeStore implements PolicyOutcomeStore {
  private readonly outcomes: PolicyOutcomeRecord[] = [];

  async recordOutcome(input: PolicyOutcomeInput): Promise<PolicyOutcomeRecord> {
    const observedAt = input.observedAt ?? new Date();
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
      observedAt,
      createdAt: new Date()
    };
    this.outcomes.push(record);
    return record;
  }

  async getOutcomesByTraceId(traceId: string): Promise<PolicyOutcomeRecord[]> {
    return this.outcomes.filter((outcome) => outcome.traceId === traceId).sort(sortOutcomes);
  }

  async listOutcomes(filters?: PolicyOutcomeFilters): Promise<PolicyOutcomeRecord[]> {
    const filtered = this.outcomes.filter((outcome) => {
      if (filters?.policyHash && outcome.policyHash !== filters.policyHash) {
        return false;
      }
      if (filters?.since && outcome.observedAt < filters.since) {
        return false;
      }
      if (filters?.until && outcome.observedAt > filters.until) {
        return false;
      }
      return true;
    });

    const sorted = filtered.sort(sortOutcomes);
    if (filters?.limit && sorted.length > filters.limit) {
      return sorted.slice(0, filters.limit);
    }
    return sorted;
  }
}

class FallbackPolicyOutcomeStore implements PolicyOutcomeStore {
  constructor(
    private readonly primary: PolicyOutcomeStore,
    private readonly fallback: PolicyOutcomeStore
  ) {}

  async recordOutcome(input: PolicyOutcomeInput): Promise<PolicyOutcomeRecord> {
    try {
      return await this.primary.recordOutcome(input);
    } catch (error) {
      return this.fallback.recordOutcome(input);
    }
  }

  async getOutcomesByTraceId(traceId: string): Promise<PolicyOutcomeRecord[]> {
    try {
      return await this.primary.getOutcomesByTraceId(traceId);
    } catch (error) {
      return this.fallback.getOutcomesByTraceId(traceId);
    }
  }

  async listOutcomes(filters?: PolicyOutcomeFilters): Promise<PolicyOutcomeRecord[]> {
    try {
      return await this.primary.listOutcomes(filters);
    } catch (error) {
      return this.fallback.listOutcomes(filters);
    }
  }
}

export function createPolicyOutcomeStore(): PolicyOutcomeStore {
  if (config.useInMemoryStore) {
    return new InMemoryPolicyOutcomeStore();
  }
  const memoryStore = new InMemoryPolicyOutcomeStore();
  return new FallbackPolicyOutcomeStore(new PostgresPolicyOutcomeStore(), memoryStore);
}

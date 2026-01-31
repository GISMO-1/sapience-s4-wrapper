import { config } from "../config";
import type { RollbackEvent } from "./types";
import { PostgresPolicyRollbackStore } from "./store.pg";

export type PolicyRollbackFilters = {
  policyHash?: string;
  fromPolicyHash?: string;
  toPolicyHash?: string;
  since?: Date;
  until?: Date;
  limit?: number;
};

export type PolicyRollbackStore = {
  recordRollback: (event: RollbackEvent) => Promise<RollbackEvent>;
  listRollbacks: (filters?: PolicyRollbackFilters) => Promise<RollbackEvent[]>;
};

function sortEvents(a: RollbackEvent, b: RollbackEvent): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt.localeCompare(b.createdAt);
  }
  if (a.eventHash !== b.eventHash) {
    return a.eventHash.localeCompare(b.eventHash);
  }
  return a.fromPolicyHash.localeCompare(b.fromPolicyHash);
}

export class InMemoryPolicyRollbackStore implements PolicyRollbackStore {
  private readonly events: RollbackEvent[] = [];

  async recordRollback(event: RollbackEvent): Promise<RollbackEvent> {
    this.events.push({ ...event });
    return event;
  }

  async listRollbacks(filters?: PolicyRollbackFilters): Promise<RollbackEvent[]> {
    const filtered = this.events.filter((event) => {
      if (filters?.policyHash) {
        if (event.fromPolicyHash !== filters.policyHash && event.toPolicyHash !== filters.policyHash) {
          return false;
        }
      }
      if (filters?.fromPolicyHash && event.fromPolicyHash !== filters.fromPolicyHash) {
        return false;
      }
      if (filters?.toPolicyHash && event.toPolicyHash !== filters.toPolicyHash) {
        return false;
      }
      if (filters?.since && new Date(event.createdAt) < filters.since) {
        return false;
      }
      if (filters?.until && new Date(event.createdAt) > filters.until) {
        return false;
      }
      return true;
    });

    const sorted = filtered.sort(sortEvents);
    if (filters?.limit && sorted.length > filters.limit) {
      return sorted.slice(0, filters.limit);
    }
    return sorted;
  }
}

class FallbackPolicyRollbackStore implements PolicyRollbackStore {
  constructor(
    private readonly primary: PolicyRollbackStore,
    private readonly fallback: PolicyRollbackStore
  ) {}

  async recordRollback(event: RollbackEvent): Promise<RollbackEvent> {
    try {
      return await this.primary.recordRollback(event);
    } catch (error) {
      return this.fallback.recordRollback(event);
    }
  }

  async listRollbacks(filters?: PolicyRollbackFilters): Promise<RollbackEvent[]> {
    try {
      return await this.primary.listRollbacks(filters);
    } catch (error) {
      return this.fallback.listRollbacks(filters);
    }
  }
}

export function createPolicyRollbackStore(): PolicyRollbackStore {
  if (config.useInMemoryStore) {
    return new InMemoryPolicyRollbackStore();
  }
  const memoryStore = new InMemoryPolicyRollbackStore();
  return new FallbackPolicyRollbackStore(new PostgresPolicyRollbackStore(), memoryStore);
}

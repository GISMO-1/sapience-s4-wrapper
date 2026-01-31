import { config } from "../config";
import type { PolicyEvent } from "./types";
import { InMemoryPolicyEventStore } from "./store.memory";
import { PostgresPolicyEventStore } from "./store.pg";

export type PolicyEventStore = {
  appendEvents: (events: PolicyEvent[]) => Promise<void>;
  listEvents: (filters?: {
    policyHash?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }) => Promise<PolicyEvent[]>;
};

class FallbackPolicyEventStore implements PolicyEventStore {
  constructor(
    private readonly primary: PolicyEventStore,
    private readonly fallback: PolicyEventStore
  ) {}

  async appendEvents(events: PolicyEvent[]): Promise<void> {
    try {
      await this.primary.appendEvents(events);
    } catch (error) {
      await this.fallback.appendEvents(events);
    }
  }

  async listEvents(filters?: {
    policyHash?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<PolicyEvent[]> {
    try {
      return await this.primary.listEvents(filters);
    } catch (error) {
      return this.fallback.listEvents(filters);
    }
  }
}

export function createPolicyEventStore(): PolicyEventStore {
  if (config.useInMemoryStore) {
    return new InMemoryPolicyEventStore();
  }
  const memoryStore = new InMemoryPolicyEventStore();
  return new FallbackPolicyEventStore(new PostgresPolicyEventStore(), memoryStore);
}

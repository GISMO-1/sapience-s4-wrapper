import { config } from "../config";
import { Intent } from "./intent-model";
import { InMemoryIntentStore } from "./intent-store.memory";
import { PostgresIntentStore } from "./intent-store.pg";

export type StoredIntent = {
  id: string;
  traceId: string;
  intent: Intent;
  createdAt: Date;
};

export interface IntentStore {
  saveIntent(intent: Intent, traceId: string): Promise<StoredIntent>;
  getIntentByTraceId(traceId: string): Promise<StoredIntent | null>;
}

class FallbackIntentStore implements IntentStore {
  constructor(
    private readonly primary: IntentStore,
    private readonly fallback: IntentStore
  ) {}

  async saveIntent(intent: Intent, traceId: string): Promise<StoredIntent> {
    try {
      return await this.primary.saveIntent(intent, traceId);
    } catch (error) {
      return this.fallback.saveIntent(intent, traceId);
    }
  }

  async getIntentByTraceId(traceId: string): Promise<StoredIntent | null> {
    try {
      return await this.primary.getIntentByTraceId(traceId);
    } catch (error) {
      return this.fallback.getIntentByTraceId(traceId);
    }
  }
}

export function createIntentStore(): IntentStore {
  if (config.useInMemoryStore) {
    return new InMemoryIntentStore();
  }
  const memoryStore = new InMemoryIntentStore();
  return new FallbackIntentStore(new PostgresIntentStore(), memoryStore);
}

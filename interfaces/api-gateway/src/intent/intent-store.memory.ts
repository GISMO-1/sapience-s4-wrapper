import { randomUUID } from "node:crypto";
import { Intent } from "./intent-model";
import { IntentStore, StoredIntent } from "./intent-store";

export class InMemoryIntentStore implements IntentStore {
  private readonly intents = new Map<string, StoredIntent>();

  async saveIntent(intent: Intent, traceId: string): Promise<StoredIntent> {
    const stored: StoredIntent = {
      id: randomUUID(),
      traceId,
      intent,
      createdAt: new Date()
    };
    this.intents.set(traceId, stored);
    return stored;
  }

  async getIntentByTraceId(traceId: string): Promise<StoredIntent | null> {
    return this.intents.get(traceId) ?? null;
  }
}

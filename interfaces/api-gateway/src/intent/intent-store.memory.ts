import { Intent } from "./intent-model";
import { IntentStore, StoredIntent } from "./intent-store";
import { generateId, now } from "../testing/determinism";

export class InMemoryIntentStore implements IntentStore {
  private readonly intents = new Map<string, StoredIntent>();

  async saveIntent(intent: Intent, traceId: string): Promise<StoredIntent> {
    const stored: StoredIntent = {
      id: generateId(),
      traceId,
      intent,
      createdAt: now()
    };
    this.intents.set(traceId, stored);
    return stored;
  }

  async getIntentByTraceId(traceId: string): Promise<StoredIntent | null> {
    return this.intents.get(traceId) ?? null;
  }
}

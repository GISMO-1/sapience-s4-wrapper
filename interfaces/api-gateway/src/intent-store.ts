import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Intent } from "./intent-model";

export type StoredIntent = {
  id: string;
  traceId: string;
  intentType: Intent["intentType"];
  rawText: string;
  parsedJson: Intent;
  triggeredBy: string;
  executionMode: string;
  createdAt: string;
};

export interface IntentStore {
  saveIntent(
    traceId: string,
    rawText: string,
    intent: Intent,
    triggeredBy: string,
    executionMode: string
  ): Promise<StoredIntent>;
  getIntentByTraceId(traceId: string): Promise<StoredIntent | null>;
}

export class PostgresIntentStore implements IntentStore {
  constructor(private readonly db: Pool) {}

  async saveIntent(
    traceId: string,
    rawText: string,
    intent: Intent,
    triggeredBy: string,
    executionMode: string
  ): Promise<StoredIntent> {
    const id = randomUUID();
    const result = await this.db.query(
      "INSERT INTO intents (id, trace_id, intent_type, raw_text, parsed_json, triggered_by, execution_mode) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING created_at",
      [id, traceId, intent.intentType, rawText, intent, triggeredBy, executionMode]
    );
    return {
      id,
      traceId,
      intentType: intent.intentType,
      rawText,
      parsedJson: intent,
      triggeredBy,
      executionMode,
      createdAt: result.rows[0].created_at.toISOString()
    };
  }

  async getIntentByTraceId(traceId: string): Promise<StoredIntent | null> {
    const result = await this.db.query(
      "SELECT id, trace_id, intent_type, raw_text, parsed_json, created_at FROM intents WHERE trace_id = $1 ORDER BY created_at DESC LIMIT 1",
      [traceId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      traceId: row.trace_id,
      intentType: row.intent_type,
      rawText: row.raw_text,
      parsedJson: row.parsed_json,
      triggeredBy: row.triggered_by,
      executionMode: row.execution_mode,
      createdAt: row.created_at.toISOString()
    };
  }
}

export class MemoryIntentStore implements IntentStore {
  private intents: StoredIntent[] = [];

  async saveIntent(
    traceId: string,
    rawText: string,
    intent: Intent,
    triggeredBy: string,
    executionMode: string
  ): Promise<StoredIntent> {
    const stored: StoredIntent = {
      id: randomUUID(),
      traceId,
      intentType: intent.intentType,
      rawText,
      parsedJson: intent,
      triggeredBy,
      executionMode,
      createdAt: new Date().toISOString()
    };
    this.intents.push(stored);
    return stored;
  }

  async getIntentByTraceId(traceId: string): Promise<StoredIntent | null> {
    const match = [...this.intents].reverse().find((intent) => intent.traceId === traceId);
    return match ?? null;
  }
}

import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { Intent, intentSchema } from "./intent-model";
import { IntentStore, StoredIntent } from "./intent-store";

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

export class PostgresIntentStore implements IntentStore {
  async saveIntent(intent: Intent, traceId: string): Promise<StoredIntent> {
    const id = uuidv4();
    const createdAt = new Date();
    await pool.query(
      "INSERT INTO intents (id, trace_id, intent_type, raw_text, parsed_json, confidence, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, traceId, intent.intentType, intent.rawText, intent, intent.confidence, createdAt]
    );
    return { id, traceId, intent, createdAt };
  }

  async getIntentByTraceId(traceId: string): Promise<StoredIntent | null> {
    const result = await pool.query(
      "SELECT id, trace_id, parsed_json, created_at FROM intents WHERE trace_id = $1 ORDER BY created_at DESC LIMIT 1",
      [traceId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    const intent = intentSchema.parse(row.parsed_json);
    return {
      id: row.id,
      traceId: row.trace_id,
      intent,
      createdAt: row.created_at
    };
  }
}

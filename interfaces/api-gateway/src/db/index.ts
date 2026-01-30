import { Pool } from "pg";
import { config } from "../config";
import { logger } from "../logger";

let pool: Pool | null = null;

export function getDb(): Pool | null {
  if (!config.db.enabled) {
    return null;
  }
  if (!pool) {
    pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database
    });
  }
  return pool;
}

export async function migrate(): Promise<void> {
  const db = getDb();
  if (!db) {
    logger.warn({ traceId: "system" }, "DB not configured; intent persistence disabled");
    return;
  }
  await db.query(
    "CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, intent_type TEXT NOT NULL, raw_text TEXT NOT NULL, parsed_json JSONB NOT NULL, triggered_by TEXT NOT NULL, execution_mode TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())"
  );
  await db.query("ALTER TABLE intents ADD COLUMN IF NOT EXISTS triggered_by TEXT NOT NULL DEFAULT 'unknown'");
  await db.query("ALTER TABLE intents ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'manual'");
  logger.info({ traceId: "system" }, "Intent storage ready");
}

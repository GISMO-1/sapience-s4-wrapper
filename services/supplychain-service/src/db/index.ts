import { Pool } from "pg";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { logger } from "../logger";

export const db = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

export async function migrate(): Promise<void> {
  const distPath = join(process.cwd(), "dist", "db", "migrations", "001_init.sql");
  const srcPath = join(process.cwd(), "src", "db", "migrations", "001_init.sql");
  const sqlPath = existsSync(distPath) ? distPath : srcPath;
  const sql = readFileSync(sqlPath, "utf8");
  await db.query(sql);
  logger.info({ traceId: "system" }, "Database migrations applied");
}

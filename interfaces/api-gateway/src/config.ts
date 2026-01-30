import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  serviceName: process.env.SERVICE_NAME ?? "api-gateway",
  procurementUrl: process.env.PROCUREMENT_URL ?? "http://localhost:3001",
  supplychainUrl: process.env.SUPPLYCHAIN_URL ?? "http://localhost:3002",
  financeUrl: process.env.FINANCE_URL ?? "http://localhost:3003",
  integrationUrl: process.env.INTEGRATION_URL ?? "http://localhost:3004",
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
  executionMode: process.env.EXECUTION_MODE ?? (process.env.EXECUTE_TOOL_CALLS === "true" ? "auto" : "manual"),
  db: {
    enabled: Boolean(process.env.DB_HOST),
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "sapience",
    password: process.env.DB_PASSWORD ?? "sapience",
    database: process.env.DB_NAME ?? "api_gateway"
  },
  logLevel: process.env.LOG_LEVEL ?? "info"
};

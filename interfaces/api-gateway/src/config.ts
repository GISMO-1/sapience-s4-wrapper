import dotenv from "dotenv";

dotenv.config();

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  serviceName: process.env.SERVICE_NAME ?? "api-gateway",
  procurementUrl: process.env.PROCUREMENT_URL ?? "http://localhost:3001",
  supplychainUrl: process.env.SUPPLYCHAIN_URL ?? "http://localhost:3002",
  financeUrl: process.env.FINANCE_URL ?? "http://localhost:3003",
  integrationUrl: process.env.INTEGRATION_URL ?? "http://localhost:3004",
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
  executeToolCalls: process.env.EXECUTE_TOOL_CALLS === "true",
  executionMode: process.env.EXECUTION_MODE ?? "manual",
  policyReloadEnabled: process.env.POLICY_RELOAD_ENABLED === "true",
  logLevel: process.env.LOG_LEVEL ?? "info",
  useInMemoryStore: process.env.USE_INMEMORY_STORE === "true",
  policyImpact: {
    weights: {
      changedDecisions: parseNumber(process.env.POLICY_IMPACT_WEIGHT_CHANGED, 1),
      denyToAllowFlips: parseNumber(process.env.POLICY_IMPACT_WEIGHT_DENY_TO_ALLOW, 5),
      rateLimitViolations: parseNumber(process.env.POLICY_IMPACT_WEIGHT_RATE_LIMIT, 3),
      highRiskSignals: parseNumber(process.env.POLICY_IMPACT_WEIGHT_HIGH_RISK, 2)
    },
    thresholds: {
      score: parseNumber(process.env.POLICY_IMPACT_SCORE_THRESHOLD, 100),
      changedDecisions: parseNumber(process.env.POLICY_IMPACT_CHANGED_THRESHOLD, 25),
      denyToAllowFlips: parseNumber(process.env.POLICY_IMPACT_DENY_TO_ALLOW_THRESHOLD, 3),
      rateLimitViolations: parseNumber(process.env.POLICY_IMPACT_RATE_LIMIT_THRESHOLD, 5),
      highRiskSignals: parseNumber(process.env.POLICY_IMPACT_HIGH_RISK_THRESHOLD, 10)
    }
  },
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "sapience",
    password: process.env.DB_PASSWORD ?? "sapience",
    database: process.env.DB_NAME ?? "gateway"
  }
};

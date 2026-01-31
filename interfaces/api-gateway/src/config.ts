import dotenv from "dotenv";

dotenv.config();

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value.toLowerCase() === "true") {
    return true;
  }
  if (value.toLowerCase() === "false") {
    return false;
  }
  return fallback;
}

function parseHealthState(value: string | undefined, fallback: "HEALTHY" | "WATCH" | "DEGRADED" | "CRITICAL") {
  if (!value) {
    return fallback;
  }
  const normalized = value.toUpperCase();
  if (normalized === "HEALTHY" || normalized === "WATCH" || normalized === "DEGRADED" || normalized === "CRITICAL") {
    return normalized;
  }
  return fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  serviceName: process.env.SERVICE_NAME ?? "api-gateway",
  procurementUrl: process.env.PROCUREMENT_URL ?? "http://localhost:3001",
  supplychainUrl: process.env.SUPPLYCHAIN_URL ?? "http://localhost:3002",
  financeUrl: process.env.FINANCE_URL ?? "http://localhost:3003",
  integrationUrl: process.env.INTEGRATION_URL ?? "http://localhost:3004",
  orchestrationUrl: process.env.ORCHESTRATION_URL ?? "http://localhost:3005",
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://localhost:8000",
  executeToolCalls: process.env.EXECUTE_TOOL_CALLS === "true",
  executionMode: process.env.EXECUTION_MODE ?? "manual",
  executionGatingEnabled: process.env.EXECUTION_GATING_ENABLED === "true",
  policyReloadEnabled: process.env.POLICY_RELOAD_ENABLED === "true",
  logLevel: process.env.LOG_LEVEL ?? "info",
  useInMemoryStore: process.env.USE_INMEMORY_STORE === "true",
  promotionGuardrails: {
    enabled: parseBoolean(process.env.PROMOTION_GUARDRAILS_ENABLED, true),
    thresholds: {
      maxBlastRadius: parseNumber(process.env.PROMOTION_MAX_BLAST_RADIUS, 25),
      maxImpactedIntents: parseNumber(process.env.PROMOTION_MAX_IMPACTED_INTENTS, 50),
      maxSeverityDelta: parseNumber(process.env.PROMOTION_MAX_SEVERITY_DELTA, 2),
      minHealthState: parseHealthState(process.env.PROMOTION_MIN_HEALTH_STATE, "WATCH"),
      maxQualityScore: parseNumber(process.env.PROMOTION_MAX_QUALITY_SCORE, 1.5)
    },
    requireRationale: parseBoolean(process.env.PROMOTION_REQUIRE_RATIONALE, true),
    requireAcceptedRisk: parseBoolean(process.env.PROMOTION_REQUIRE_ACCEPTED_RISK, true)
  },
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

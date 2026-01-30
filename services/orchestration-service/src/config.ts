import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3005),
  serviceName: process.env.SERVICE_NAME ?? "orchestration-service",
  brokerBrokers: (process.env.BROKER_BROKERS ?? "localhost:9092").split(","),
  executionMode: process.env.EXECUTION_MODE ?? "manual",
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "sapience",
    password: process.env.DB_PASSWORD ?? "sapience",
    database: process.env.DB_NAME ?? "orchestration"
  },
  logLevel: process.env.LOG_LEVEL ?? "info",
  useInMemoryStore: process.env.USE_INMEMORY_STORE === "true"
};

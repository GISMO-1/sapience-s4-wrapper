import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3003),
  serviceName: process.env.SERVICE_NAME ?? "finance-service",
  brokerBrokers: (process.env.BROKER_BROKERS ?? "localhost:9092").split(","),
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "sapience",
    password: process.env.DB_PASSWORD ?? "sapience",
    database: process.env.DB_NAME ?? "finance"
  },
  logLevel: process.env.LOG_LEVEL ?? "info"
};

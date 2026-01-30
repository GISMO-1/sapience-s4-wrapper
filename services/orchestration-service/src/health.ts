import { FastifyInstance } from "fastify";
import { db } from "./db";
import { Kafka } from "kafkajs";
import { config } from "./config";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async () => {
    await db.query("SELECT 1");
    const kafka = new Kafka({ clientId: config.serviceName, brokers: config.brokerBrokers });
    const admin = kafka.admin();
    await admin.connect();
    await admin.listTopics();
    await admin.disconnect();
    return { status: "ready" };
  });
}

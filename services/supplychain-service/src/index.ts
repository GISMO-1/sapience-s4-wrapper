import Fastify from "fastify";
import { config } from "./config";
import { logger } from "./logger";
import { registerHealthRoutes } from "./health";
import { registerRoutes } from "./api/routes";
import { migrate, db } from "./db";
import { consumer, startConsumer, stopConsumer } from "./events/consumer";
import { producer, startProducer, stopProducer } from "./events/producer";
import { topics } from "./events/topics";
import { EventEnvelope } from "./events/envelope";
import { v4 as uuidv4 } from "uuid";
import { startTelemetry, stopTelemetry } from "./telemetry";
import { ensureTraceId, TraceAwareRequest } from "./trace";
import { randomUUID } from "node:crypto";

const app = Fastify({ logger: false });
let lowStockTimer: NodeJS.Timeout | null = null;

async function start(): Promise<void> {
  await startTelemetry();
  await migrate();
  app.addHook("onRequest", (request, reply, done) => {
    ensureTraceId(request as TraceAwareRequest, reply);
    done();
  });
  await startProducer();
  await startConsumer();

  await consumer.subscribe({ topic: topics.integrationPoCreated, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) {
        logger.warn({ traceId: "system" }, "Received empty message");
        return;
      }

      try {
        const payload = JSON.parse(message.value.toString()) as EventEnvelope<{
          id: string;
          sku: string;
          quantity: number;
          status: string;
        }>;
        const traceId = payload.traceId ?? "unknown";
        logger.info({ traceId, eventType: payload.type }, "Event consumed");

        await db.query(
          "INSERT INTO inventory (sku, quantity, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (sku) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity, updated_at = NOW()",
          [payload.data.sku, payload.data.quantity]
        );
        logger.info(
          { sku: payload.data.sku, traceId, eventType: payload.type },
          "Updated inventory projection"
        );
      } catch (error) {
        logger.error({ error, traceId: "system", eventType: topics.integrationPoCreated }, "Failed to update inventory projection");
      }
    }
  });

  lowStockTimer = setInterval(async () => {
    try {
      const result = await db.query("SELECT sku, quantity FROM inventory WHERE quantity <= $1", [
        config.lowStockThreshold
      ]);

      for (const row of result.rows) {
        const traceId = randomUUID();
        const event: EventEnvelope<{ sku: string; quantity: number }> = {
          id: uuidv4(),
          type: topics.supplychainLowStockDetected,
          source: config.serviceName,
          time: new Date().toISOString(),
          subject: row.sku,
          traceId,
          data: { sku: row.sku, quantity: row.quantity }
        };

        await producer.send({
          topic: topics.supplychainLowStockDetected,
          messages: [{ value: JSON.stringify(event) }]
        });
        logger.info(
          { sku: row.sku, traceId, eventType: event.type },
          "Published low stock event"
        );
      }
    } catch (error) {
      logger.error({ error, traceId: "system", eventType: topics.supplychainLowStockDetected }, "Low stock scan failed");
    }
  }, 15000);

  await registerHealthRoutes(app);
  await registerRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port, traceId: "system" }, "Supply chain service listening");
}

async function shutdown(): Promise<void> {
  logger.info({ traceId: "system" }, "Shutting down supply chain service");
  if (lowStockTimer) {
    clearInterval(lowStockTimer);
  }
  await stopConsumer();
  await stopProducer();
  await db.end();
  await stopTelemetry();
  await app.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

start().catch((error) => {
  logger.error({ error, traceId: "system" }, "Failed to start supply chain service");
  process.exit(1);
});

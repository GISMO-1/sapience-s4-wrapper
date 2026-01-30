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

const app = Fastify({ logger: false });

async function start(): Promise<void> {
  await startTelemetry();
  await migrate();
  await startProducer();
  await startConsumer();

  await consumer.subscribe({ topic: topics.supplychainLowStockDetected, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) {
        logger.warn("Received empty message");
        return;
      }

      try {
        const payload = JSON.parse(message.value.toString()) as EventEnvelope<{ sku: string; quantity: number }>;
        const sagaId = uuidv4();
        await db.query(
          "INSERT INTO sagas (id, status, sku, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())",
          [sagaId, "started", payload.data.sku]
        );

        const poRequest = {
          sku: payload.data.sku,
          quantity: Math.max(10, payload.data.quantity * 2)
        };

        const event: EventEnvelope<typeof poRequest> = {
          id: uuidv4(),
          type: topics.procurementPoRequested,
          source: config.serviceName,
          time: new Date().toISOString(),
          subject: payload.data.sku,
          data: poRequest
        };

        await producer.send({
          topic: topics.procurementPoRequested,
          messages: [{ value: JSON.stringify(event) }]
        });

        await db.query("UPDATE sagas SET status = $1, updated_at = NOW() WHERE id = $2", [
          "requested",
          sagaId
        ]);
        logger.info({ sagaId, sku: payload.data.sku }, "Saga requested procurement");
      } catch (error) {
        logger.error({ error }, "Failed to orchestrate procurement saga");
      }
    }
  });

  await registerHealthRoutes(app);
  await registerRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port }, "Orchestration service listening");
}

async function shutdown(): Promise<void> {
  logger.info("Shutting down orchestration service");
  await stopConsumer();
  await stopProducer();
  await db.end();
  await stopTelemetry();
  await app.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

start().catch((error) => {
  logger.error({ error }, "Failed to start orchestration service");
  process.exit(1);
});

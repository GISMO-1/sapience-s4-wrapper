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
import { startTelemetry, stopTelemetry } from "./telemetry";
import { ensureTraceId, TraceAwareRequest } from "./trace";

const app = Fastify({ logger: false });

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
          "INSERT INTO accruals (id, sku, quantity, status) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
          [payload.data.id, payload.data.sku, payload.data.quantity, "accrued"]
        );
        logger.info(
          { purchaseOrderId: payload.data.id, traceId, eventType: payload.type },
          "Recorded accrual"
        );
      } catch (error) {
        logger.error({ error, traceId: "system", eventType: topics.integrationPoCreated }, "Failed to process PO completion event");
      }
    }
  });

  await registerHealthRoutes(app);
  await registerRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port, traceId: "system" }, "Finance service listening");
}

async function shutdown(): Promise<void> {
  logger.info({ traceId: "system" }, "Shutting down finance service");
  await stopConsumer();
  await stopProducer();
  await db.end();
  await stopTelemetry();
  await app.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

start().catch((error) => {
  logger.error({ error, traceId: "system" }, "Failed to start finance service");
  process.exit(1);
});

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
import { buildPoCreatedEvent } from "./handlers";

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

  await consumer.subscribe({ topic: topics.procurementPoRequested, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) {
        logger.warn({ traceId: "system" }, "Received empty message");
        return;
      }

      try {
        const payload = JSON.parse(message.value.toString()) as EventEnvelope<{ sku: string; quantity: number }>;
        const traceId = payload.traceId ?? "unknown";
        logger.info({ traceId, eventType: payload.type }, "Event consumed");
        logger.info({ traceId, eventType: "sap.adapter.invoked" }, "Invoking SAP adapter");
        const completion = await buildPoCreatedEvent(payload);
        await db.query(
          "INSERT INTO purchase_orders (id, sku, quantity, status) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
          [completion.data.id, completion.data.sku, completion.data.quantity, completion.data.status]
        );

        await producer.send({
          topic: topics.integrationPoCreated,
          messages: [{ value: JSON.stringify(completion) }]
        });
        logger.info(
          { purchaseOrderId: completion.data.id, traceId, eventType: completion.type },
          "Published integration PO created event"
        );
      } catch (error) {
        logger.error({ error, traceId: "system", eventType: topics.procurementPoRequested }, "Failed to process intent event");
      }
    }
  });

  await registerHealthRoutes(app);
  await registerRoutes(app);

  app.get("/", async () => ({ service: config.serviceName }));

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port, traceId: "system" }, "Integration service listening");
}

async function shutdown(): Promise<void> {
  logger.info({ traceId: "system" }, "Shutting down integration service");
  await stopConsumer();
  await stopProducer();
  await db.end();
  await stopTelemetry();
  await app.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

start().catch((error) => {
  logger.error({ error, traceId: "system" }, "Failed to start integration service");
  process.exit(1);
});

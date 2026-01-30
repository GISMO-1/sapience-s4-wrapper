import Fastify from "fastify";
import { config } from "./config";
import { logger } from "./logger";
import { registerHealthRoutes } from "./health";
import { registerRoutes } from "./api/routes";
import { migrate, db } from "./db";
import { consumer, startConsumer, stopConsumer } from "./events/consumer";
import { producer, startProducer, stopProducer } from "./events/producer";
import { topics } from "./events/topics";
import { FakeSapAdapter } from "./sap/fakeAdapter";
import { EventEnvelope } from "./events/envelope";
import { randomUUID } from "node:crypto";
import { startTelemetry, stopTelemetry } from "./telemetry";
import { ensureTraceId, getTraceIdFromRequest, withTraceId } from "./trace/trace";

const app = Fastify({ logger: false });
const sapAdapter = new FakeSapAdapter();

async function start(): Promise<void> {
  await startTelemetry();
  app.addHook("onRequest", (request, reply, done) => {
    const traceId = getTraceIdFromRequest(request);
    reply.header("x-trace-id", traceId);
    (request.headers as Record<string, string>)["x-trace-id"] = traceId;
    done();
  });
  await migrate();
  await startProducer();
  await startConsumer();

  await consumer.subscribe({ topic: topics.procurementPoRequested, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) {
        logger.warn("Received empty message");
        return;
      }

      try {
        const payload = JSON.parse(message.value.toString()) as EventEnvelope<{ sku: string; quantity: number }>;
        const traceId = ensureTraceId({ "x-trace-id": payload.traceId });
        const result = await sapAdapter.createPurchaseOrder(payload.data);
        await db.query(
          "INSERT INTO purchase_orders (id, sku, quantity, status) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
          [result.id, result.sku, result.quantity, result.status]
        );

        const completion: EventEnvelope<typeof result> = {
          id: randomUUID(),
          type: topics.integrationPoCreated,
          source: config.serviceName,
          time: new Date().toISOString(),
          subject: result.id,
          traceId,
          data: result
        };

        await producer.send({
          topic: topics.integrationPoCreated,
          messages: [{ value: JSON.stringify(completion) }]
        });
        withTraceId(logger, traceId).info({ purchaseOrderId: result.id }, "Published integration PO created event");
      } catch (error) {
        logger.error({ error }, "Failed to process intent event");
      }
    }
  });

  await registerHealthRoutes(app);
  await registerRoutes(app);

  app.get("/", async () => ({ service: config.serviceName }));

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port }, "Integration service listening");
}

async function shutdown(): Promise<void> {
  logger.info("Shutting down integration service");
  await stopConsumer();
  await stopProducer();
  await db.end();
  await stopTelemetry();
  await app.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

start().catch((error) => {
  logger.error({ error }, "Failed to start integration service");
  process.exit(1);
});

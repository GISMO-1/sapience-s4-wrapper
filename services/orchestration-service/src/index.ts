import Fastify from "fastify";
import { config } from "./config";
import { logger } from "./logger";
import { registerHealthRoutes } from "./health";
import { registerRoutes } from "./api/routes";
import { db, migrate } from "./db";
import { consumer, startConsumer, stopConsumer } from "./events/consumer";
import { producer, startProducer, stopProducer } from "./events/producer";
import { topics } from "./events/topics";
import { EventEnvelope } from "./events/envelope";
import { randomUUID } from "node:crypto";
import { startTelemetry, stopTelemetry } from "./telemetry";
import { ensureTraceId, getTraceIdFromRequest, withTraceId } from "./trace/trace";
import { buildSagaEventId, buildSagaId } from "./saga/saga";
import { createSagaStore } from "./saga/saga-store";
import { SagaStatus } from "./saga/saga-types";

const app = Fastify({ logger: false });
const sagaStore = createSagaStore();

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

  await consumer.subscribe({ topic: topics.supplychainLowStockDetected, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) {
        logger.warn("Received empty message");
        return;
      }

      try {
        const payload = JSON.parse(message.value.toString()) as EventEnvelope<{ sku: string; quantity: number }>;
        const traceId = ensureTraceId({ "x-trace-id": payload.traceId });
        const sagaId = buildSagaId(traceId, payload.data.sku);
        const existingSaga = await sagaStore.getSagaById(sagaId);
        const status: SagaStatus = existingSaga?.status ?? "NEW";
        await sagaStore.upsertSaga({
          sagaId,
          traceId,
          sku: payload.data.sku,
          status
        });

        await sagaStore.recordEvent({
          id: buildSagaEventId(sagaId, "LOW_STOCK_DETECTED", "NEW"),
          sagaId,
          traceId,
          state: "NEW",
          eventType: "LOW_STOCK_DETECTED",
          payload: payload.data
        });

        if (status !== "NEW") {
          withTraceId(logger, traceId).info({ sagaId, status }, "Saga already processed low stock");
          return;
        }

        const poRequest = {
          sku: payload.data.sku,
          quantity: Math.max(10, payload.data.quantity * 2)
        };

        const event: EventEnvelope<typeof poRequest> = {
          id: randomUUID(),
          type: topics.procurementPoRequested,
          source: config.serviceName,
          time: new Date().toISOString(),
          subject: payload.data.sku,
          traceId,
          data: poRequest
        };

        await producer.send({
          topic: topics.procurementPoRequested,
          messages: [{ value: JSON.stringify(event) }]
        });

        await sagaStore.updateSagaStatus(sagaId, "REQUESTED");
        await sagaStore.recordEvent({
          id: buildSagaEventId(sagaId, "PO_REQUESTED", "REQUESTED"),
          sagaId,
          traceId,
          state: "REQUESTED",
          eventType: "PO_REQUESTED",
          payload: poRequest
        });
        withTraceId(logger, traceId).info({ sagaId, sku: payload.data.sku }, "Saga requested procurement");
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

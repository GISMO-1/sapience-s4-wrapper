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
import { handleLowStockEvent, handlePoCreatedEvent } from "./saga";
import { PostgresSagaRepository } from "./saga-store";

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

  const sagaRepository = new PostgresSagaRepository(db);

  await consumer.subscribe({ topic: topics.supplychainLowStockDetected, fromBeginning: true });
  await consumer.subscribe({ topic: topics.integrationPoCreated, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) {
        logger.warn({ traceId: "system" }, "Received empty message");
        return;
      }

      try {
        const payload = JSON.parse(message.value.toString()) as EventEnvelope<{
          sku: string;
          quantity: number;
        }>;

        if (payload.type === topics.supplychainLowStockDetected) {
          logger.info({ traceId: payload.traceId, eventType: payload.type }, "Event consumed");
          const { sagaId, event, created } = await handleLowStockEvent(sagaRepository, payload);
          if (created) {
            logger.info({ sagaId, traceId: payload.traceId, eventType: payload.type }, "Saga started");
          }
          if (event) {
            await producer.send({
              topic: topics.procurementPoRequested,
              messages: [{ value: JSON.stringify(event) }]
            });
            logger.info(
              { sagaId, traceId: payload.traceId, eventType: event.type },
              "Saga requested procurement"
            );
          }
        } else if (payload.type === topics.integrationPoCreated) {
          const completionPayload = payload as EventEnvelope<{
            id: string;
            sku: string;
            quantity: number;
            status: string;
          }>;
          logger.info({ traceId: completionPayload.traceId, eventType: completionPayload.type }, "Event consumed");
          const result = await handlePoCreatedEvent(sagaRepository, completionPayload);
          if (result.state) {
            logger.info(
              { sagaId: result.sagaId, traceId: completionPayload.traceId, eventType: completionPayload.type },
              `Saga ${result.state.toLowerCase()}`
            );
          }
        }
      } catch (error) {
        logger.error({ error, traceId: "system", eventType: "saga.handler" }, "Failed to orchestrate procurement saga");
      }
    }
  });

  await registerHealthRoutes(app);
  await registerRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port, traceId: "system" }, "Orchestration service listening");
}

async function shutdown(): Promise<void> {
  logger.info({ traceId: "system" }, "Shutting down orchestration service");
  await stopConsumer();
  await stopProducer();
  await db.end();
  await stopTelemetry();
  await app.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

start().catch((error) => {
  logger.error({ error, traceId: "system" }, "Failed to start orchestration service");
  process.exit(1);
});

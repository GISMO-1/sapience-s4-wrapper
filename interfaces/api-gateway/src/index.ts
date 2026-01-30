import Fastify from "fastify";
import { config } from "./config";
import { logger } from "./logger";
import { registerHealthRoutes } from "./health";
import { registerRoutes } from "./routes";
import { startTelemetry, stopTelemetry } from "./telemetry";
import { migrate } from "./db";
import { ensureTraceId, TraceAwareRequest } from "./trace";

const app = Fastify({ logger: false });

async function start(): Promise<void> {
  await startTelemetry();
  await migrate();
  app.addHook("onRequest", (request, reply, done) => {
    ensureTraceId(request as TraceAwareRequest, reply);
    done();
  });
  await registerHealthRoutes(app);
  await registerRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port, traceId: "system" }, "API gateway listening");
}

async function shutdown(): Promise<void> {
  logger.info({ traceId: "system" }, "Shutting down API gateway");
  await stopTelemetry();
  await app.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

start().catch((error) => {
  logger.error({ error, traceId: "system" }, "Failed to start API gateway");
  process.exit(1);
});

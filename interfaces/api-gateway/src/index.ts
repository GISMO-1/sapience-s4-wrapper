import Fastify from "fastify";
import { config } from "./config";
import { logger } from "./logger";
import { registerHealthRoutes } from "./health";
import { registerRoutes } from "./routes";
import { startTelemetry, stopTelemetry } from "./telemetry";

const app = Fastify({ logger: false });

async function start(): Promise<void> {
  await startTelemetry();
  await registerHealthRoutes(app);
  await registerRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port }, "API gateway listening");
}

async function shutdown(): Promise<void> {
  logger.info("Shutting down API gateway");
  await stopTelemetry();
  await app.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

start().catch((error) => {
  logger.error({ error }, "Failed to start API gateway");
  process.exit(1);
});

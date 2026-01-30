import { FastifyInstance } from "fastify";
import { config } from "./config";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async () => {
    const targets = [
      `${config.procurementUrl}/health`,
      `${config.supplychainUrl}/health`,
      `${config.financeUrl}/health`,
      `${config.integrationUrl}/health`
    ];

    await Promise.all(
      targets.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Dependency unhealthy: ${url}`);
        }
      })
    );

    return { status: "ready" };
  });
}

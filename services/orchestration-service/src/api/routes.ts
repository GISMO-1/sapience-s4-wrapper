import { FastifyInstance } from "fastify";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/sagas", async () => ({ status: "ok" }));
}

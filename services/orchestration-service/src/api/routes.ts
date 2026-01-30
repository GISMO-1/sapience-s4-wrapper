import { FastifyInstance } from "fastify";
import { createSagaStore } from "../saga/saga-store";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const sagaStore = createSagaStore();

  app.get("/v1/sagas", async () => ({ status: "ok" }));

  app.get("/v1/sagas/:traceId", async (request, reply) => {
    const traceId = String((request.params as { traceId: string }).traceId);
    const events = await sagaStore.getEventsByTraceId(traceId);
    if (events.length === 0) {
      reply.code(404);
      return { message: "Saga not found", traceId };
    }
    return { traceId, events };
  });
}

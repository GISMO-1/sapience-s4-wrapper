import { FastifyInstance } from "fastify";
import { logger } from "../logger";
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

  app.post("/v1/intent/execute", async (request, reply) => {
    const traceId = String((request.body as { traceId?: string })?.traceId ?? "");
    if (!traceId) {
      reply.code(400);
      return { message: "traceId is required" };
    }
    const decision = (request.body as { decision?: { policyHash?: string; decisionId?: string } })?.decision;
    logger.info(
      {
        traceId,
        policyHash: decision?.policyHash ?? null,
        decisionId: decision?.decisionId ?? null
      },
      "Received intent execution request"
    );
    return { ok: true, traceId };
  });
}

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { producer } from "../events/producer";
import { topics } from "../events/topics";
import { EventEnvelope } from "../events/envelope";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { logger } from "../logger";
import { TraceAwareRequest } from "../trace";

const requestSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive()
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/purchase-orders/request", async (request, reply) => {
    const body = requestSchema.parse(request.body);
    const traceId = (request as TraceAwareRequest).traceId ?? "unknown";

    const event: EventEnvelope<typeof body> = {
      id: uuidv4(),
      type: topics.procurementPoRequested,
      source: config.serviceName,
      time: new Date().toISOString(),
      subject: body.sku,
      traceId,
      data: body
    };

    await producer.send({
      topic: topics.procurementPoRequested,
      messages: [{ value: JSON.stringify(event) }]
    });
    logger.info({ traceId, eventType: event.type }, "Event published");

    reply.code(202);
    return { status: "queued", eventId: event.id };
  });
}

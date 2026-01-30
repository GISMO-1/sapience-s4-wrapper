import { FastifyInstance } from "fastify";
import { z } from "zod";
import { producer } from "../events/producer";
import { topics } from "../events/topics";
import { EventEnvelope } from "../events/envelope";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";

const requestSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive()
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/purchase-orders/request", async (request, reply) => {
    const body = requestSchema.parse(request.body);

    const event: EventEnvelope<typeof body> = {
      id: uuidv4(),
      type: topics.procurementPoRequested,
      source: config.serviceName,
      time: new Date().toISOString(),
      subject: body.sku,
      traceId: request.headers["x-trace-id"] as string | undefined,
      data: body
    };

    await producer.send({
      topic: topics.procurementPoRequested,
      messages: [{ value: JSON.stringify(event) }]
    });

    reply.code(202);
    return { status: "queued", eventId: event.id };
  });
}

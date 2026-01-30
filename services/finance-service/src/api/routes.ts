import { FastifyInstance } from "fastify";
import { z } from "zod";
import { producer } from "../events/producer";
import { topics } from "../events/topics";
import { EventEnvelope } from "../events/envelope";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { config } from "../config";

const requestSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive()
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/invoices/review-request", async (request, reply) => {
    const body = requestSchema.parse(request.body);
    const event: EventEnvelope<typeof body> = {
      id: uuidv4(),
      type: topics.financeInvoiceReviewRequested,
      source: config.serviceName,
      time: new Date().toISOString(),
      subject: body.invoiceId,
      traceId: request.headers["x-trace-id"] as string | undefined,
      data: body
    };

    await db.query(
      "INSERT INTO invoice_reviews (id, amount, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [body.invoiceId, body.amount, "requested"]
    );

    await producer.send({
      topic: topics.financeInvoiceReviewRequested,
      messages: [{ value: JSON.stringify(event) }]
    });

    reply.code(202);
    return { status: "queued", eventId: event.id };
  });
}

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db";

const paramsSchema = z.object({ sku: z.string().min(1) });

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/inventory/:sku", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const result = await db.query("SELECT * FROM inventory WHERE sku = $1", [params.sku]);
    if (result.rows.length === 0) {
      reply.code(404);
      return { message: "SKU not found" };
    }
    return result.rows[0];
  });
}

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db";

const paramsSchema = z.object({ id: z.string().min(1) });

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/sap/purchase-orders/:id", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const result = await db.query("SELECT * FROM purchase_orders WHERE id = $1", [params.id]);
    if (result.rows.length === 0) {
      reply.code(404);
      return { message: "Purchase order not found" };
    }
    return result.rows[0];
  });
}

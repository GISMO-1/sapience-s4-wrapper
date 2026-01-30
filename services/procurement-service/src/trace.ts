import { randomUUID } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";

export type TraceAwareRequest = FastifyRequest & { traceId?: string };

export function ensureTraceId(request: TraceAwareRequest, reply: FastifyReply): string {
  const existing = request.headers["x-trace-id"];
  const traceId = typeof existing === "string" && existing.trim().length > 0 ? existing : randomUUID();
  request.traceId = traceId;
  reply.header("x-trace-id", traceId);
  return traceId;
}

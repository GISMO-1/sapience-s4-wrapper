import type { FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { v4 as uuidv4 } from "uuid";

const TRACE_HEADER = "x-trace-id";

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function ensureTraceId(headers?: Record<string, string | string[] | undefined>): string {
  const candidate = headers ? normalizeHeader(headers[TRACE_HEADER]) : undefined;
  if (candidate && candidate.trim().length > 0) {
    return candidate;
  }
  return uuidv4();
}

export function getTraceIdFromRequest(request: Pick<FastifyRequest, "headers">): string {
  return ensureTraceId(request.headers as Record<string, string | string[] | undefined>);
}

export function withTraceId(logger: Logger, traceId: string): Logger {
  return logger.child({ traceId });
}

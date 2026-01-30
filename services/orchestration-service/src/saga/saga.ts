import { createHash } from "node:crypto";
import { SagaEventType, SagaStatus } from "./saga-types";

export function buildSagaId(traceId: string, sku: string): string {
  return createHash("sha256").update(`${traceId}:${sku}`).digest("hex");
}

export function buildSagaEventId(sagaId: string, eventType: SagaEventType, state: SagaStatus): string {
  return createHash("sha256").update(`${sagaId}:${eventType}:${state}`).digest("hex");
}

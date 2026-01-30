import { randomUUID } from "node:crypto";
import { EventEnvelope } from "./events/envelope";
import { topics } from "./events/topics";
import { config } from "./config";

export type SagaState = "NEW" | "REQUESTED" | "CONFIRMED" | "COMPLETED" | "FAILED";

export type SagaRecord = {
  id: string;
  traceId: string;
  sku: string;
  status: SagaState;
};

export type SagaEventRecord = {
  id: string;
  sagaId: string;
  traceId: string;
  state: SagaState;
  eventType: string;
  eventId: string;
  payload: unknown;
};

export interface SagaRepository {
  getSagaByTraceId(traceId: string): Promise<SagaRecord | null>;
  createSaga(record: SagaRecord): Promise<void>;
  updateSagaState(sagaId: string, nextState: SagaState): Promise<void>;
  recordSagaEvent(record: SagaEventRecord): Promise<boolean>;
}

export function buildPoRequestedEvent(traceId: string, parentSpanId: string | undefined, sku: string, quantity: number) {
  const payload = { sku, quantity };
  const event: EventEnvelope<typeof payload> = {
    id: randomUUID(),
    type: topics.procurementPoRequested,
    source: config.serviceName,
    time: new Date().toISOString(),
    subject: sku,
    traceId,
    parentSpanId,
    data: payload
  };
  return event;
}

export async function handleLowStockEvent(
  repo: SagaRepository,
  payload: EventEnvelope<{ sku: string; quantity: number }>
) {
  const traceId = payload.traceId;
  const existingSaga = await repo.getSagaByTraceId(traceId);
  const sagaId = existingSaga?.id ?? traceId;
  const created = !existingSaga;

  if (created) {
    await repo.createSaga({ id: sagaId, traceId, sku: payload.data.sku, status: "NEW" });
  }

  const recorded = await repo.recordSagaEvent({
    id: randomUUID(),
    sagaId,
    traceId,
    state: existingSaga?.status ?? "NEW",
    eventType: payload.type,
    eventId: payload.id,
    payload: payload.data
  });

  if (!recorded) {
    return { sagaId, event: null, created };
  }

  const nextState: SagaState = "REQUESTED";
  await repo.updateSagaState(sagaId, nextState);

  const event = buildPoRequestedEvent(
    traceId,
    payload.id,
    payload.data.sku,
    Math.max(10, payload.data.quantity * 2)
  );

  await repo.recordSagaEvent({
    id: randomUUID(),
    sagaId,
    traceId,
    state: nextState,
    eventType: event.type,
    eventId: event.id,
    payload: event.data
  });

  return { sagaId, event, created };
}

export async function handlePoCreatedEvent(
  repo: SagaRepository,
  payload: EventEnvelope<{ id: string; sku: string; quantity: number; status: string }>
) {
  const traceId = payload.traceId;
  const saga = await repo.getSagaByTraceId(traceId);
  if (!saga) {
    return { sagaId: null, state: null };
  }

  const recorded = await repo.recordSagaEvent({
    id: randomUUID(),
    sagaId: saga.id,
    traceId,
    state: saga.status,
    eventType: payload.type,
    eventId: payload.id,
    payload: payload.data
  });

  if (!recorded) {
    return { sagaId: saga.id, state: saga.status };
  }

  const nextState: SagaState = payload.data.status === "created" ? "COMPLETED" : "FAILED";
  await repo.updateSagaState(saga.id, nextState);

  return { sagaId: saga.id, state: nextState };
}

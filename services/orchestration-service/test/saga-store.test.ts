import { expect, test } from "vitest";

test("records saga events idempotently in memory", async () => {
  process.env.USE_INMEMORY_STORE = "true";
  const { createSagaStore } = await import("../src/saga/saga-store");
  const { buildSagaEventId } = await import("../src/saga/saga");

  const store = createSagaStore();
  const sagaId = "saga-1";
  const traceId = "trace-1";

  await store.upsertSaga({ sagaId, traceId, sku: "SKU-1", status: "NEW" });

  const eventId = buildSagaEventId(sagaId, "LOW_STOCK_DETECTED", "NEW");
  await store.recordEvent({
    id: eventId,
    sagaId,
    traceId,
    state: "NEW",
    eventType: "LOW_STOCK_DETECTED",
    payload: { sku: "SKU-1", quantity: 2 }
  });
  await store.recordEvent({
    id: eventId,
    sagaId,
    traceId,
    state: "NEW",
    eventType: "LOW_STOCK_DETECTED",
    payload: { sku: "SKU-1", quantity: 2 }
  });

  const events = await store.getEventsByTraceId(traceId);
  expect(events).toHaveLength(1);
});

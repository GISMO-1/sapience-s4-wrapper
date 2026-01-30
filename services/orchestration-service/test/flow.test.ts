import { describe, expect, test, vi } from "vitest";
import { MemorySagaRepository } from "../src/saga-store";
import { handleLowStockEvent, handlePoCreatedEvent } from "../src/saga";
import { topics } from "../src/events/topics";
import { EventEnvelope } from "../src/events/envelope";
import { MemoryIntentStore } from "../../interfaces/api-gateway/src/intent-store";
import { parseIntent } from "../../interfaces/api-gateway/src/intent-model";
import { buildPoCreatedEvent } from "../../integration-service/src/handlers";

describe("integration flow", () => {
  test("low stock intent triggers saga and completion", async () => {
    const traceId = "trace-low-stock";
    const intentStore = new MemoryIntentStore();
    const intent = parseIntent("low stock SKU123");
    await intentStore.saveIntent(traceId, "low stock SKU123", intent, "test", "manual");
    const storedIntent = await intentStore.getIntentByTraceId(traceId);
    expect(storedIntent?.rawText).toBe("low stock SKU123");

    const repo = new MemorySagaRepository();
    const lowStockEvent: EventEnvelope<{ sku: string; quantity: number }> = {
      id: "event-low-stock",
      type: topics.supplychainLowStockDetected,
      source: "supplychain",
      time: new Date().toISOString(),
      subject: "SKU123",
      traceId,
      data: { sku: "SKU123", quantity: 2 }
    };

    const { sagaId, event } = await handleLowStockEvent(repo, lowStockEvent);
    expect(event?.type).toBe(topics.procurementPoRequested);
    expect(event?.traceId).toBe(traceId);
    expect(sagaId).toBe(traceId);

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.1);
    const completion = await buildPoCreatedEvent(event!);
    randomSpy.mockRestore();
    const result = await handlePoCreatedEvent(repo, completion);
    expect(result.state).toBe("COMPLETED");
  });

  test("duplicate low stock event is idempotent", async () => {
    const traceId = "trace-idempotent";
    const repo = new MemorySagaRepository();
    const event: EventEnvelope<{ sku: string; quantity: number }> = {
      id: "event-dup",
      type: topics.supplychainLowStockDetected,
      source: "supplychain",
      time: new Date().toISOString(),
      subject: "SKU123",
      traceId,
      data: { sku: "SKU123", quantity: 1 }
    };

    const first = await handleLowStockEvent(repo, event);
    const second = await handleLowStockEvent(repo, event);
    expect(first.event).not.toBeNull();
    expect(second.event).toBeNull();
  });
});

import { v4 as uuidv4 } from "uuid";
import { FakeSapAdapter } from "./sap/fakeAdapter";
import { EventEnvelope } from "./events/envelope";
import { topics } from "./events/topics";
import { config } from "./config";

const adapter = new FakeSapAdapter();

export async function buildPoCreatedEvent(
  payload: EventEnvelope<{ sku: string; quantity: number }>
): Promise<EventEnvelope<{ id: string; sku: string; quantity: number; status: string }>> {
  const result = await adapter.createPurchaseOrder(payload.data);
  return {
    id: uuidv4(),
    type: topics.integrationPoCreated,
    source: config.serviceName,
    time: new Date().toISOString(),
    subject: result.id,
    traceId: payload.traceId,
    parentSpanId: payload.id,
    data: result
  };
}

import { SagaEventRecord, SagaRecord, SagaStatus } from "./saga-types";
import { NewSaga, NewSagaEvent, SagaStore } from "./saga-store";

export class InMemorySagaStore implements SagaStore {
  private readonly sagas = new Map<string, SagaRecord>();
  private readonly events: SagaEventRecord[] = [];

  async upsertSaga(saga: NewSaga): Promise<SagaRecord> {
    const now = new Date();
    const existing = this.sagas.get(saga.sagaId);
    if (existing) {
      const updated: SagaRecord = { ...existing, status: saga.status, updatedAt: now };
      this.sagas.set(saga.sagaId, updated);
      return updated;
    }
    const created: SagaRecord = {
      sagaId: saga.sagaId,
      traceId: saga.traceId,
      sku: saga.sku,
      status: saga.status,
      createdAt: now,
      updatedAt: now
    };
    this.sagas.set(saga.sagaId, created);
    return created;
  }

  async getSagaById(sagaId: string): Promise<SagaRecord | null> {
    return this.sagas.get(sagaId) ?? null;
  }

  async updateSagaStatus(sagaId: string, status: SagaStatus): Promise<SagaRecord | null> {
    const existing = this.sagas.get(sagaId);
    if (!existing) {
      return null;
    }
    const updated: SagaRecord = { ...existing, status, updatedAt: new Date() };
    this.sagas.set(sagaId, updated);
    return updated;
  }

  async recordEvent(event: NewSagaEvent): Promise<SagaEventRecord | null> {
    const alreadyRecorded = this.events.find((existing) => existing.id === event.id);
    if (alreadyRecorded) {
      return alreadyRecorded;
    }
    const record: SagaEventRecord = {
      ...event,
      createdAt: new Date()
    };
    this.events.push(record);
    return record;
  }

  async getEventsByTraceId(traceId: string): Promise<SagaEventRecord[]> {
    return this.events.filter((event) => event.traceId === traceId);
  }
}

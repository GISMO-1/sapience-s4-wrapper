import { config } from "../config";
import { InMemorySagaStore } from "./saga-store.memory";
import { PostgresSagaStore } from "./saga-store.pg";
import { SagaEventRecord, SagaEventType, SagaRecord, SagaStatus } from "./saga-types";

export type NewSaga = {
  sagaId: string;
  traceId: string;
  sku: string;
  status: SagaStatus;
};

export type NewSagaEvent = {
  id: string;
  sagaId: string;
  traceId: string;
  state: SagaStatus;
  eventType: SagaEventType;
  payload: Record<string, unknown>;
};

export interface SagaStore {
  upsertSaga(saga: NewSaga): Promise<SagaRecord>;
  getSagaById(sagaId: string): Promise<SagaRecord | null>;
  updateSagaStatus(sagaId: string, status: SagaStatus): Promise<SagaRecord | null>;
  recordEvent(event: NewSagaEvent): Promise<SagaEventRecord | null>;
  getEventsByTraceId(traceId: string): Promise<SagaEventRecord[]>;
}

class FallbackSagaStore implements SagaStore {
  constructor(
    private readonly primary: SagaStore,
    private readonly fallback: SagaStore
  ) {}

  async upsertSaga(saga: NewSaga): Promise<SagaRecord> {
    try {
      return await this.primary.upsertSaga(saga);
    } catch (error) {
      return this.fallback.upsertSaga(saga);
    }
  }

  async getSagaById(sagaId: string): Promise<SagaRecord | null> {
    try {
      return await this.primary.getSagaById(sagaId);
    } catch (error) {
      return this.fallback.getSagaById(sagaId);
    }
  }

  async updateSagaStatus(sagaId: string, status: SagaStatus): Promise<SagaRecord | null> {
    try {
      return await this.primary.updateSagaStatus(sagaId, status);
    } catch (error) {
      return this.fallback.updateSagaStatus(sagaId, status);
    }
  }

  async recordEvent(event: NewSagaEvent): Promise<SagaEventRecord | null> {
    try {
      return await this.primary.recordEvent(event);
    } catch (error) {
      return this.fallback.recordEvent(event);
    }
  }

  async getEventsByTraceId(traceId: string): Promise<SagaEventRecord[]> {
    try {
      return await this.primary.getEventsByTraceId(traceId);
    } catch (error) {
      return this.fallback.getEventsByTraceId(traceId);
    }
  }
}

export function createSagaStore(): SagaStore {
  if (config.useInMemoryStore) {
    return new InMemorySagaStore();
  }
  const memoryStore = new InMemorySagaStore();
  return new FallbackSagaStore(new PostgresSagaStore(), memoryStore);
}

import { Pool } from "pg";
import { SagaRecord, SagaRepository, SagaEventRecord } from "./saga";

export class PostgresSagaRepository implements SagaRepository {
  constructor(private readonly db: Pool) {}

  async getSagaByTraceId(traceId: string): Promise<SagaRecord | null> {
    const result = await this.db.query(
      "SELECT id, trace_id, status, sku FROM sagas WHERE trace_id = $1 LIMIT 1",
      [traceId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      id: row.id,
      traceId: row.trace_id,
      status: row.status,
      sku: row.sku
    };
  }

  async createSaga(record: SagaRecord): Promise<void> {
    await this.db.query(
      "INSERT INTO sagas (id, trace_id, status, sku, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) ON CONFLICT (id) DO NOTHING",
      [record.id, record.traceId, record.status, record.sku]
    );
  }

  async updateSagaState(sagaId: string, nextState: string): Promise<void> {
    await this.db.query("UPDATE sagas SET status = $1, updated_at = NOW() WHERE id = $2", [
      nextState,
      sagaId
    ]);
  }

  async recordSagaEvent(record: SagaEventRecord): Promise<boolean> {
    const result = await this.db.query(
      "INSERT INTO saga_events (id, saga_id, trace_id, state, event_type, event_id, payload) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (event_id) DO NOTHING",
      [
        record.id,
        record.sagaId,
        record.traceId,
        record.state,
        record.eventType,
        record.eventId,
        record.payload
      ]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export class MemorySagaRepository implements SagaRepository {
  private sagas = new Map<string, SagaRecord>();
  private events = new Map<string, SagaEventRecord>();

  async getSagaByTraceId(traceId: string): Promise<SagaRecord | null> {
    return this.sagas.get(traceId) ?? null;
  }

  async createSaga(record: SagaRecord): Promise<void> {
    this.sagas.set(record.traceId, record);
  }

  async updateSagaState(sagaId: string, nextState: string): Promise<void> {
    const saga = [...this.sagas.values()].find((entry) => entry.id === sagaId);
    if (!saga) {
      return;
    }
    saga.status = nextState as SagaRecord["status"];
  }

  async recordSagaEvent(record: SagaEventRecord): Promise<boolean> {
    if (this.events.has(record.eventId)) {
      return false;
    }
    this.events.set(record.eventId, record);
    return true;
  }
}

import { db } from "../db";
import { SagaEventRecord, SagaRecord, SagaStatus } from "./saga-types";
import { NewSaga, NewSagaEvent, SagaStore } from "./saga-store";

export class PostgresSagaStore implements SagaStore {
  async upsertSaga(saga: NewSaga): Promise<SagaRecord> {
    const result = await db.query(
      "INSERT INTO sagas (saga_id, trace_id, sku, status, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) ON CONFLICT (saga_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW() RETURNING saga_id, trace_id, sku, status, created_at, updated_at",
      [saga.sagaId, saga.traceId, saga.sku, saga.status]
    );
    return this.mapSaga(result.rows[0]);
  }

  async getSagaById(sagaId: string): Promise<SagaRecord | null> {
    const result = await db.query(
      "SELECT saga_id, trace_id, sku, status, created_at, updated_at FROM sagas WHERE saga_id = $1",
      [sagaId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapSaga(result.rows[0]);
  }

  async updateSagaStatus(sagaId: string, status: SagaStatus): Promise<SagaRecord | null> {
    const result = await db.query(
      "UPDATE sagas SET status = $2, updated_at = NOW() WHERE saga_id = $1 RETURNING saga_id, trace_id, sku, status, created_at, updated_at",
      [sagaId, status]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapSaga(result.rows[0]);
  }

  async recordEvent(event: NewSagaEvent): Promise<SagaEventRecord | null> {
    const result = await db.query(
      "INSERT INTO saga_events (id, saga_id, trace_id, state, event_type, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (id) DO NOTHING RETURNING id, saga_id, trace_id, state, event_type, payload, created_at",
      [event.id, event.sagaId, event.traceId, event.state, event.eventType, event.payload]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapEvent(result.rows[0]);
  }

  async getEventsByTraceId(traceId: string): Promise<SagaEventRecord[]> {
    const result = await db.query(
      "SELECT id, saga_id, trace_id, state, event_type, payload, created_at FROM saga_events WHERE trace_id = $1 ORDER BY created_at ASC",
      [traceId]
    );
    return result.rows.map((row) => this.mapEvent(row));
  }

  private mapSaga(row: any): SagaRecord {
    return {
      sagaId: row.saga_id,
      traceId: row.trace_id,
      sku: row.sku,
      status: row.status,
      simulated: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapEvent(row: any): SagaEventRecord {
    return {
      id: row.id,
      sagaId: row.saga_id,
      traceId: row.trace_id,
      state: row.state,
      eventType: row.event_type,
      payload: row.payload ?? {},
      createdAt: row.created_at
    };
  }
}

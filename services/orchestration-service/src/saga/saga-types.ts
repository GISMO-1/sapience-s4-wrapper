export type SagaStatus = "NEW" | "REQUESTED" | "COMPLETED" | "FAILED";

export type SagaRecord = {
  sagaId: string;
  traceId: string;
  sku: string;
  status: SagaStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type SagaEventType = "LOW_STOCK_DETECTED" | "PO_REQUESTED" | "PO_COMPLETED" | "SAGA_FAILED";

export type SagaEventRecord = {
  id: string;
  sagaId: string;
  traceId: string;
  state: SagaStatus;
  eventType: SagaEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type EventEnvelope<T> = {
  id: string;
  type: string;
  source: string;
  time: string;
  subject?: string;
  traceId: string;
  parentSpanId?: string;
  data: T;
};

CREATE TABLE IF NOT EXISTS policy_events (
  event_id TEXT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor TEXT,
  trace_id TEXT,
  policy_hash TEXT,
  kind TEXT NOT NULL,
  parent_event_id TEXT,
  payload_json JSONB NOT NULL,
  event_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_events_policy_hash_occurred_at ON policy_events (policy_hash, occurred_at);
CREATE INDEX IF NOT EXISTS idx_policy_events_trace_id ON policy_events (trace_id);
CREATE INDEX IF NOT EXISTS idx_policy_events_kind ON policy_events (kind);

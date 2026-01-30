CREATE TABLE IF NOT EXISTS intents (
  id UUID PRIMARY KEY,
  trace_id TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  parsed_json JSONB NOT NULL,
  confidence NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intents_trace_id_idx ON intents (trace_id);

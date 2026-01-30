DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sagas' AND column_name = 'id'
  ) THEN
    EXECUTE 'ALTER TABLE sagas RENAME COLUMN id TO saga_id';
  END IF;
END $$;

ALTER TABLE sagas ADD COLUMN IF NOT EXISTS trace_id TEXT;

CREATE TABLE IF NOT EXISTS saga_events (
  id TEXT PRIMARY KEY,
  saga_id TEXT NOT NULL REFERENCES sagas(saga_id),
  trace_id TEXT NOT NULL,
  state TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS saga_events_trace_id_idx ON saga_events (trace_id);

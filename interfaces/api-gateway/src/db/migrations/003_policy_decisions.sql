CREATE TABLE IF NOT EXISTS policy_decisions (
  id UUID PRIMARY KEY,
  trace_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  decision TEXT NOT NULL,
  matched_rule_ids TEXT[] NOT NULL,
  reasons JSONB NOT NULL,
  categories TEXT[] NOT NULL,
  risk JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS policy_decisions_trace_id_idx ON policy_decisions (trace_id);

-- README: stores deterministic policy decisions for intent traces.
-- Inputs: trace_id, policy_hash, decision, matched_rule_ids, reasons, categories, risk.
-- Outputs: persisted records queried by trace_id for explain output.
-- Example:
-- psql -d gateway -c "SELECT * FROM policy_decisions WHERE trace_id = 'trace-123' ORDER BY created_at DESC LIMIT 1;"
-- Self-check:
-- psql -d gateway -c "SELECT COUNT(*) FROM policy_decisions;"

CREATE TABLE IF NOT EXISTS policy_replay_runs (
  id UUID PRIMARY KEY,
  requested_by TEXT NULL,
  baseline_policy_hash TEXT NOT NULL,
  candidate_policy_hash TEXT NOT NULL,
  candidate_policy_source TEXT NOT NULL,
  candidate_policy_ref TEXT NULL,
  intent_type_filter TEXT[] NULL,
  since TIMESTAMPTZ NULL,
  until TIMESTAMPTZ NULL,
  "limit" INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_replay_results (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES policy_replay_runs(id) ON DELETE CASCADE,
  trace_id TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  baseline_decision TEXT NOT NULL,
  candidate_decision TEXT NOT NULL,
  changed BOOLEAN NOT NULL,
  baseline_policy_hash TEXT NOT NULL,
  candidate_policy_hash TEXT NOT NULL,
  baseline_matched_rules TEXT[] NOT NULL,
  candidate_matched_rules TEXT[] NOT NULL,
  reasons JSONB NOT NULL,
  categories TEXT[] NOT NULL,
  risk JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS policy_replay_runs_created_at_idx ON policy_replay_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS policy_replay_results_run_id_idx ON policy_replay_results (run_id);
CREATE INDEX IF NOT EXISTS policy_replay_results_changed_idx ON policy_replay_results (changed);

-- README: stores policy replay runs and per-intent replay results for traceability.
-- Inputs: run metadata + per-intent baseline/candidate decisions, matched rules, reasons, categories, risk.
-- Outputs: persisted replay records queried by run_id with stable ordering.
-- Example:
-- psql -d gateway -c "SELECT * FROM policy_replay_runs ORDER BY created_at DESC LIMIT 1;"
-- Self-check:
-- psql -d gateway -c "SELECT COUNT(*) FROM policy_replay_results;"

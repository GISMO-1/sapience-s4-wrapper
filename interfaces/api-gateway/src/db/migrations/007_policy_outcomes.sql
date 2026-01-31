CREATE TABLE IF NOT EXISTS policy_outcomes (
  id UUID PRIMARY KEY,
  trace_id TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  decision TEXT NOT NULL,
  outcome_type TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 1,
  human_override BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS policy_outcomes_trace_id_idx ON policy_outcomes (trace_id);
CREATE INDEX IF NOT EXISTS policy_outcomes_hash_outcome_idx ON policy_outcomes (policy_hash, outcome_type);
CREATE INDEX IF NOT EXISTS policy_outcomes_observed_at_idx ON policy_outcomes (observed_at);

-- README: store real-world outcomes tied to trace IDs for policy quality feedback loops.
-- Inputs: trace IDs, intent types, policy hashes, decisions, outcome types, severity, and optional notes.
-- psql -d gateway -c "SELECT trace_id, outcome_type, severity FROM policy_outcomes ORDER BY observed_at DESC LIMIT 5;"

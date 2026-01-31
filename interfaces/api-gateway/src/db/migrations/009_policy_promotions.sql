CREATE TABLE IF NOT EXISTS policy_promotions (
  id TEXT PRIMARY KEY,
  policy_hash TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL,
  reviewer TEXT NOT NULL,
  rationale TEXT NOT NULL,
  accepted_risk_score NUMERIC NULL,
  forced BOOLEAN NOT NULL,
  guardrail_decision JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS policy_promotions_policy_hash_idx ON policy_promotions (policy_hash);
CREATE INDEX IF NOT EXISTS policy_promotions_created_at_idx ON policy_promotions (created_at DESC);

-- README: stores policy promotion guardrail decisions and reviewer metadata.
-- Inputs: policy hash, guardrail decision snapshot, reviewer/rationale, accepted risk, forced flag.
-- psql -d gateway -c "SELECT policy_hash, reviewer, forced FROM policy_promotions ORDER BY created_at DESC LIMIT 5;"

CREATE TABLE IF NOT EXISTS policy_lineage (
  policy_hash TEXT PRIMARY KEY,
  parent_policy_hash TEXT NULL,
  promoted_by TEXT NOT NULL,
  promoted_at TIMESTAMPTZ NOT NULL,
  rationale TEXT NOT NULL,
  accepted_risk_score NUMERIC NOT NULL,
  source TEXT NOT NULL,
  constraints_added INTEGER NOT NULL,
  constraints_removed INTEGER NOT NULL,
  severity_delta INTEGER NOT NULL,
  net_risk_score_change INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS policy_lineage_parent_idx ON policy_lineage (parent_policy_hash);
CREATE INDEX IF NOT EXISTS policy_lineage_promoted_at_idx ON policy_lineage (promoted_at DESC);

ALTER TABLE policy_replay_results
  ADD COLUMN IF NOT EXISTS baseline_risk JSONB;

-- README: stores policy lineage metadata with drift summaries and adds baseline risk to replay results.
-- Inputs: policy hashes, promotion metadata, drift summary counts, baseline risk from policy decisions.
-- psql -d gateway -c "SELECT * FROM policy_lineage ORDER BY promoted_at DESC LIMIT 5;"
-- psql -d gateway -c "SELECT baseline_risk FROM policy_replay_results WHERE baseline_risk IS NOT NULL LIMIT 5;"

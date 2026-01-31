CREATE TABLE IF NOT EXISTS decision_rationales (
  decision_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL,
  rationale_blocks JSONB NOT NULL,
  rejected_alternatives JSONB NOT NULL,
  accepted_risk JSONB NOT NULL,
  timestamps JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS decision_rationales_trace_id_idx ON decision_rationales (trace_id);
CREATE INDEX IF NOT EXISTS decision_rationales_policy_hash_idx ON decision_rationales (policy_hash);

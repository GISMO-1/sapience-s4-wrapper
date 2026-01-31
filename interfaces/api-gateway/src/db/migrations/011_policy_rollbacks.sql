CREATE TABLE IF NOT EXISTS policy_rollbacks (
  event_hash TEXT PRIMARY KEY,
  from_policy_hash TEXT NOT NULL,
  to_policy_hash TEXT NOT NULL,
  actor TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS policy_rollbacks_to_policy_hash_idx ON policy_rollbacks (to_policy_hash);
CREATE INDEX IF NOT EXISTS policy_rollbacks_created_at_idx ON policy_rollbacks (created_at);
CREATE INDEX IF NOT EXISTS policy_rollbacks_from_to_hash_idx ON policy_rollbacks (from_policy_hash, to_policy_hash);

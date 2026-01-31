CREATE TABLE IF NOT EXISTS intent_approvals (
  id text PRIMARY KEY,
  trace_id text NOT NULL,
  intent_id text NOT NULL,
  policy_hash text NOT NULL,
  decision_id text NOT NULL,
  required_role text NOT NULL,
  actor text NOT NULL,
  rationale text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intent_approvals_trace_id_idx ON intent_approvals (trace_id);
CREATE INDEX IF NOT EXISTS intent_approvals_intent_id_idx ON intent_approvals (intent_id);
CREATE INDEX IF NOT EXISTS intent_approvals_decision_id_idx ON intent_approvals (decision_id);
CREATE INDEX IF NOT EXISTS intent_approvals_policy_hash_idx ON intent_approvals (policy_hash);

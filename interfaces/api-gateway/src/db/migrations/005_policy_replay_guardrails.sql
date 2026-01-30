ALTER TABLE policy_replay_results
  ADD COLUMN IF NOT EXISTS candidate_constraint_types TEXT[] NOT NULL DEFAULT '{}';

-- README: stores candidate rule constraint types for policy replay guardrails and impact scoring.

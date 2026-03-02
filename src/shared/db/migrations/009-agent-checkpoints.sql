CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id BIGSERIAL PRIMARY KEY,
  agent_name TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  checkpoint_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_name, scope_key, checkpoint_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_scope
  ON agent_checkpoints (agent_name, scope_key);

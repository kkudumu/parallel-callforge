CREATE TABLE IF NOT EXISTS pipeline_run_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           TEXT NOT NULL,
  offer_id         TEXT NOT NULL,
  agent_name       TEXT NOT NULL,
  step             TEXT NOT NULL,
  city             TEXT,
  state            TEXT,
  status           TEXT NOT NULL CHECK (status IN ('success', 'failed', 'recovered', 'dead')),
  model_used       TEXT,
  duration_ms      INTEGER NOT NULL,
  error_message    TEXT,
  fix_applied      TEXT,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_run_log_run_id_idx
  ON pipeline_run_log (run_id);

CREATE INDEX IF NOT EXISTS pipeline_run_log_agent_step_idx
  ON pipeline_run_log (agent_name, step);

CREATE INDEX IF NOT EXISTS pipeline_run_log_status_idx
  ON pipeline_run_log (status);

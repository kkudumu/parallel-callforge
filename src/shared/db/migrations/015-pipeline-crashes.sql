CREATE TABLE IF NOT EXISTS pipeline_crashes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_run_id       TEXT NOT NULL,
  offer_id                TEXT NOT NULL,
  attempt                 INTEGER NOT NULL,
  exit_code               INTEGER,
  signal                  TEXT,
  stdout_tail             TEXT,
  stderr_tail             TEXT,
  duration_ms             INTEGER NOT NULL,
  memory_usage_mb         INTEGER,
  crashed_at              TIMESTAMPTZ NOT NULL,
  diagnosis_root_cause    TEXT,
  diagnosis_category      TEXT CHECK (diagnosis_category IN (
    'oom', 'timeout', 'llm_failure', 'db_failure',
    'file_io', 'validation', 'unhandled', 'signal', 'unknown'
  )),
  diagnosis_is_transient  BOOLEAN,
  diagnosis_preventive_fix TEXT,
  diagnosis_pattern_label TEXT,
  diagnosis_confidence    NUMERIC(3,2),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_crashes_supervisor_run ON pipeline_crashes (supervisor_run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_crashes_offer ON pipeline_crashes (offer_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_crashes_category ON pipeline_crashes (diagnosis_category);

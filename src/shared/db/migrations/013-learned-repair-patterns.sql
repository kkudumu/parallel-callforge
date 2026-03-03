CREATE TABLE IF NOT EXISTS learned_repair_patterns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type     TEXT NOT NULL CHECK (pattern_type IN ('failure_pattern', 'success_pattern')),
  agent_name       TEXT NOT NULL,
  step             TEXT NOT NULL,
  trigger          TEXT NOT NULL,
  fix_strategy     TEXT,
  best_practice    TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_to_code BOOLEAN NOT NULL DEFAULT false,
  promoted_at      TIMESTAMPTZ,
  notes            TEXT,
  UNIQUE (agent_name, step, trigger)
);

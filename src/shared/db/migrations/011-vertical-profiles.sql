CREATE TABLE IF NOT EXISTS vertical_profiles (
  id BIGSERIAL PRIMARY KEY,
  vertical_key TEXT NOT NULL UNIQUE,
  niche TEXT NOT NULL,
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vertical_profiles_niche
  ON vertical_profiles (niche);

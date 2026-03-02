CREATE TABLE IF NOT EXISTS offer_profiles (
  id BIGSERIAL PRIMARY KEY,
  offer_id TEXT NOT NULL UNIQUE,
  niche TEXT NOT NULL,
  vertical TEXT NOT NULL,
  raw_offer_text TEXT NOT NULL,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_profiles_niche
  ON offer_profiles (niche);

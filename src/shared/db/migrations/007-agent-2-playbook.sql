ALTER TABLE copy_frameworks
ADD COLUMN IF NOT EXISTS cta_microcopy JSONB NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS guarantees JSONB NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS reading_level JSONB NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS vertical_angles JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS competitor_analyses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche           TEXT NOT NULL UNIQUE,
  analysis        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

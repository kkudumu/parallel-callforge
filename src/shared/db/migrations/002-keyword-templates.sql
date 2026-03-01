CREATE TABLE keyword_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche      TEXT NOT NULL UNIQUE,
  templates  TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


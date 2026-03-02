CREATE TABLE IF NOT EXISTS site_builds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_key        TEXT NOT NULL,
  niche           TEXT NOT NULL,
  build_number    INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'QUEUED'
                    CHECK (status IN (
                      'QUEUED',
                      'GENERATING_CONTENT',
                      'BUILDING',
                      'QA_CHECK',
                      'DEPLOYING_DRAFT',
                      'DEPLOYING_LIVE',
                      'LIVE',
                      'FAILED'
                    )),
  attempt_count   INT NOT NULL DEFAULT 1,
  target_cities   JSONB NOT NULL DEFAULT '[]',
  draft_url       TEXT,
  live_url        TEXT,
  build_output    JSONB NOT NULL DEFAULT '{}',
  errors          JSONB NOT NULL DEFAULT '[]',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_key, build_number)
);

CREATE INDEX idx_site_builds_site_key ON site_builds (site_key, created_at DESC);
CREATE INDEX idx_site_builds_status ON site_builds (status, updated_at DESC);

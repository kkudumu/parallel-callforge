CREATE TABLE geo_zip_reference (
  zip_code             TEXT PRIMARY KEY
                         CHECK (zip_code ~ '^[0-9]{5}$'),
  city                 TEXT NOT NULL,
  state                TEXT NOT NULL,
  county               TEXT,
  latitude             NUMERIC(9,6),
  longitude            NUMERIC(9,6),
  population_estimate  INT
);

CREATE TABLE offer_geo_coverage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    TEXT NOT NULL,
  zip_code    TEXT NOT NULL
                CHECK (zip_code ~ '^[0-9]{5}$'),
  source      TEXT NOT NULL DEFAULT 'import',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offer_id, zip_code)
);

CREATE INDEX idx_offer_geo_coverage_offer_id
  ON offer_geo_coverage (offer_id);

CREATE TABLE deployment_candidates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id            TEXT NOT NULL,
  city                TEXT NOT NULL,
  state               TEXT NOT NULL,
  zip_codes           TEXT[] NOT NULL DEFAULT '{}',
  eligible_zip_count  INT NOT NULL DEFAULT 0,
  population          INT NOT NULL DEFAULT 0,
  pre_keyword_score   NUMERIC(6,2) NOT NULL DEFAULT 0,
  keyword_score       NUMERIC(6,2),
  final_score         NUMERIC(6,2),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','researched','approved','rejected','deployed')),
  reasoning           JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offer_id, city, state)
);

CREATE INDEX idx_deployment_candidates_offer_score
  ON deployment_candidates (offer_id, pre_keyword_score DESC);

CREATE INDEX idx_deployment_candidates_status
  ON deployment_candidates (status, updated_at DESC);

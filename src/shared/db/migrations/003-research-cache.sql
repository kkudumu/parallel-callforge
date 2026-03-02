ALTER TABLE city_keyword_map
  ADD COLUMN IF NOT EXISTS research_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE schema_templates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE seasonal_calendars
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS keyword_metrics_cache (
  keyword       TEXT PRIMARY KEY,
  metrics       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autocomplete_cache (
  query         TEXT PRIMARY KEY,
  suggestions   TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trends_cache (
  niche         TEXT NOT NULL,
  geo           TEXT NOT NULL,
  top_queries   JSONB NOT NULL DEFAULT '{}',
  rising_queries JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (niche, geo)
);

CREATE TABLE IF NOT EXISTS city_scoring_cache (
  niche             TEXT PRIMARY KEY,
  input_fingerprint TEXT NOT NULL,
  candidate_cities  JSONB NOT NULL DEFAULT '[]',
  scored_cities     JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hugo_template_cache (
  niche             TEXT PRIMARY KEY,
  design_fingerprint TEXT NOT NULL,
  baseof            TEXT NOT NULL,
  city_hub          TEXT NOT NULL,
  service_subpage   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

WITH keyword_cluster_dedupe AS (
  SELECT
    id AS old_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY city, state, niche, primary_keyword
      ORDER BY created_at DESC, id DESC
    ) AS keep_id
  FROM keyword_clusters
),
keyword_cluster_rewrites AS (
  SELECT old_id, keep_id
  FROM keyword_cluster_dedupe
  WHERE old_id <> keep_id
)
UPDATE city_keyword_map AS ckm
SET keyword_cluster_ids = COALESCE((
  SELECT ARRAY_AGG(resolved_id ORDER BY first_seen)
  FROM (
    SELECT
      COALESCE(rewrite.keep_id, expanded.cluster_id) AS resolved_id,
      MIN(expanded.ordinality) AS first_seen
    FROM UNNEST(ckm.keyword_cluster_ids) WITH ORDINALITY AS expanded(cluster_id, ordinality)
    LEFT JOIN keyword_cluster_rewrites AS rewrite
      ON rewrite.old_id = expanded.cluster_id
    GROUP BY COALESCE(rewrite.keep_id, expanded.cluster_id)
  ) AS deduped
), '{}'::uuid[])
WHERE EXISTS (
  SELECT 1
  FROM keyword_cluster_rewrites AS rewrite
  WHERE rewrite.old_id = ANY(ckm.keyword_cluster_ids)
);

WITH keyword_cluster_dedupe AS (
  SELECT
    id AS old_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY city, state, niche, primary_keyword
      ORDER BY created_at DESC, id DESC
    ) AS keep_id
  FROM keyword_clusters
)
DELETE FROM keyword_clusters AS kc
USING keyword_cluster_dedupe AS dedupe
WHERE kc.id = dedupe.old_id
  AND dedupe.old_id <> dedupe.keep_id;

WITH city_keyword_map_dedupe AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY city, state, niche
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_num
  FROM city_keyword_map
)
DELETE FROM city_keyword_map AS ckm
USING city_keyword_map_dedupe AS dedupe
WHERE ckm.id = dedupe.id
  AND dedupe.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_city_keyword_map_city_state_niche_unique
  ON city_keyword_map (city, state, niche);

CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_clusters_city_state_niche_primary_unique
  ON keyword_clusters (city, state, niche, primary_keyword);

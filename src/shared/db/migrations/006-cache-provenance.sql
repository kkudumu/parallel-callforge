ALTER TABLE keyword_templates
  ADD COLUMN IF NOT EXISTS cache_provider TEXT NOT NULL DEFAULT 'llm',
  ADD COLUMN IF NOT EXISTS cache_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS retrieval_method TEXT NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3);

ALTER TABLE keyword_metrics_cache
  ADD COLUMN IF NOT EXISTS cache_provider TEXT NOT NULL DEFAULT 'google-autocomplete+google-trends',
  ADD COLUMN IF NOT EXISTS cache_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS retrieval_method TEXT NOT NULL DEFAULT 'estimated',
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3);

ALTER TABLE autocomplete_cache
  ADD COLUMN IF NOT EXISTS cache_provider TEXT NOT NULL DEFAULT 'google-autocomplete',
  ADD COLUMN IF NOT EXISTS cache_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS retrieval_method TEXT NOT NULL DEFAULT 'estimated',
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3);

ALTER TABLE trends_cache
  ADD COLUMN IF NOT EXISTS cache_provider TEXT NOT NULL DEFAULT 'google-trends',
  ADD COLUMN IF NOT EXISTS cache_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS retrieval_method TEXT NOT NULL DEFAULT 'estimated',
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3);

ALTER TABLE city_scoring_cache
  ADD COLUMN IF NOT EXISTS cache_provider TEXT NOT NULL DEFAULT 'llm',
  ADD COLUMN IF NOT EXISTS cache_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS retrieval_method TEXT NOT NULL DEFAULT 'estimated',
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3);

ALTER TABLE hugo_template_cache
  ADD COLUMN IF NOT EXISTS cache_provider TEXT NOT NULL DEFAULT 'llm',
  ADD COLUMN IF NOT EXISTS cache_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS retrieval_method TEXT NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,3);

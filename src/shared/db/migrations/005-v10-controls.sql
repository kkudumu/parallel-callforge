ALTER TABLE keyword_metrics_cache
  ADD COLUMN IF NOT EXISTS cache_source TEXT NOT NULL DEFAULT 'estimated';

ALTER TABLE autocomplete_cache
  ADD COLUMN IF NOT EXISTS cache_source TEXT NOT NULL DEFAULT 'estimated';

ALTER TABLE trends_cache
  ADD COLUMN IF NOT EXISTS cache_source TEXT NOT NULL DEFAULT 'estimated';

ALTER TABLE city_scoring_cache
  ADD COLUMN IF NOT EXISTS cache_source TEXT NOT NULL DEFAULT 'estimated';

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS indexation_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (indexation_status IN ('unknown', 'pending', 'indexed', 'not_indexed'));

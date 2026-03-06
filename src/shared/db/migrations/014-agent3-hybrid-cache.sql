CREATE TABLE IF NOT EXISTS agent3_page_brief_cache (
  cache_key          TEXT PRIMARY KEY,
  niche              TEXT NOT NULL,
  route_key          TEXT NOT NULL,
  page_type          TEXT NOT NULL,
  packet_fingerprint TEXT NOT NULL,
  brief_json         JSONB NOT NULL,
  cache_provider     TEXT NOT NULL DEFAULT 'llm',
  cache_version      TEXT NOT NULL DEFAULT 'v1',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_a3_brief_niche_route
  ON agent3_page_brief_cache (niche, route_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent3_content_block_cache (
  cache_key          TEXT PRIMARY KEY,
  niche              TEXT NOT NULL,
  route_key          TEXT NOT NULL,
  page_type          TEXT NOT NULL,
  packet_fingerprint TEXT NOT NULL,
  blocks_json        JSONB NOT NULL,
  cache_provider     TEXT NOT NULL DEFAULT 'llm',
  cache_version      TEXT NOT NULL DEFAULT 'v1',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_a3_blocks_niche_route
  ON agent3_content_block_cache (niche, route_key, updated_at DESC);

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Agent task queue
CREATE TABLE agent_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type        TEXT NOT NULL,
  agent_name       TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','completed','failed')),
  dependencies     UUID[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  error_message    TEXT
);

CREATE INDEX idx_agent_tasks_status ON agent_tasks (status);
CREATE INDEX idx_agent_tasks_agent ON agent_tasks (agent_name);

-- Dead-letter queue
CREATE TABLE dead_letter_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_task_id UUID NOT NULL,
  task_type        TEXT NOT NULL,
  agent_name       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  error_message    TEXT NOT NULL,
  error_stack      TEXT,
  error_class      TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (error_class IN ('transient','permanent','unknown')),
  retry_count      INT NOT NULL DEFAULT 0,
  max_retries      INT NOT NULL DEFAULT 3,
  first_failed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  resolution       TEXT CHECK (resolution IN ('retried','skipped','manual','expired')),
  notes            TEXT,
  fingerprint      TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dlq_unresolved ON dead_letter_queue (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_dlq_agent ON dead_letter_queue (agent_name, last_failed_at DESC);
CREATE INDEX idx_dlq_fingerprint ON dead_letter_queue (fingerprint);

-- Keyword clusters (Agent 1 output)
CREATE TABLE keyword_clusters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_name      TEXT NOT NULL,
  primary_keyword   TEXT NOT NULL,
  secondary_keywords TEXT[] NOT NULL DEFAULT '{}',
  search_volume     INT NOT NULL DEFAULT 0,
  difficulty        NUMERIC(5,2) NOT NULL DEFAULT 0,
  intent            TEXT NOT NULL CHECK (intent IN ('informational','transactional','navigational','commercial')),
  city              TEXT,
  state             TEXT,
  niche             TEXT NOT NULL DEFAULT 'pest-control',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kc_niche ON keyword_clusters (niche);
CREATE INDEX idx_kc_city ON keyword_clusters (city);

-- City keyword map (Agent 1 output)
CREATE TABLE city_keyword_map (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city               TEXT NOT NULL,
  state              TEXT NOT NULL,
  population         INT NOT NULL DEFAULT 0,
  priority_score     NUMERIC(5,2) NOT NULL DEFAULT 0,
  keyword_cluster_ids UUID[] NOT NULL DEFAULT '{}',
  url_mapping        JSONB NOT NULL DEFAULT '{}',
  deployment_status  TEXT NOT NULL DEFAULT 'pending'
                       CHECK (deployment_status IN ('pending','in_progress','deployed','paused')),
  niche              TEXT NOT NULL DEFAULT 'pest-control',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Design specs (Agent 2 output)
CREATE TABLE design_specs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche                 TEXT NOT NULL UNIQUE,
  archetype             TEXT NOT NULL,
  layout                JSONB NOT NULL DEFAULT '{}',
  components            JSONB NOT NULL DEFAULT '[]',
  colors                JSONB NOT NULL DEFAULT '{}',
  typography            JSONB NOT NULL DEFAULT '{}',
  responsive_breakpoints JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Copy frameworks (Agent 2 output)
CREATE TABLE copy_frameworks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche           TEXT NOT NULL UNIQUE,
  headlines       JSONB NOT NULL DEFAULT '[]',
  ctas            JSONB NOT NULL DEFAULT '[]',
  trust_signals   JSONB NOT NULL DEFAULT '[]',
  faq_templates   JSONB NOT NULL DEFAULT '[]',
  pas_scripts     JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schema templates (Agent 2 output)
CREATE TABLE schema_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche             TEXT NOT NULL UNIQUE,
  jsonld_templates  JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seasonal calendar (Agent 2 output)
CREATE TABLE seasonal_calendars (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  niche           TEXT NOT NULL UNIQUE,
  months          JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Content items (Agent 3 tracking)
CREATE TABLE content_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','review','published','archived')),
  target_keyword    TEXT,
  search_volume     INT,
  keyword_difficulty NUMERIC(5,2),
  pest_type         TEXT,
  city              TEXT,
  content_type      TEXT NOT NULL CHECK (content_type IN ('city_hub','service_subpage','blog_post')),
  scheduled_date    DATE,
  published_date    TIMESTAMPTZ,
  author_persona    TEXT,
  quality_score     JSONB,
  word_count        INT,
  niche             TEXT NOT NULL DEFAULT 'pest-control',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ci_status ON content_items (status, published_date);

-- Pages (Agent 3 deployed pages)
CREATE TABLE pages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url             TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  city            TEXT NOT NULL,
  state           TEXT NOT NULL,
  niche           TEXT NOT NULL DEFAULT 'pest-control',
  target_keyword  TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','sunset')),
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance snapshots (Agent 7)
CREATE TABLE performance_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id              UUID NOT NULL REFERENCES pages(id),
  snapshot_date        DATE NOT NULL,
  sessions             INT NOT NULL DEFAULT 0,
  users                INT NOT NULL DEFAULT 0,
  pageviews            INT NOT NULL DEFAULT 0,
  organic_sessions     INT NOT NULL DEFAULT 0,
  bounce_rate          NUMERIC(5,4),
  avg_session_duration NUMERIC(8,2),
  click_to_call_count  INT NOT NULL DEFAULT 0,
  calls_total          INT NOT NULL DEFAULT 0,
  calls_qualified      INT NOT NULL DEFAULT 0,
  revenue              NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, snapshot_date)
);

-- Ranking snapshots (Agent 7)
CREATE TABLE ranking_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id         UUID NOT NULL REFERENCES pages(id),
  snapshot_date   DATE NOT NULL,
  query           TEXT NOT NULL,
  device          TEXT NOT NULL DEFAULT 'MOBILE',
  clicks          INT NOT NULL DEFAULT 0,
  impressions     INT NOT NULL DEFAULT 0,
  ctr             NUMERIC(5,4),
  position        NUMERIC(5,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, snapshot_date, query, device)
);

-- Call records (Agent 7)
CREATE TABLE call_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_call_id  TEXT,
  page_id           UUID REFERENCES pages(id),
  call_timestamp    TIMESTAMPTZ NOT NULL,
  duration_seconds  INT NOT NULL DEFAULT 0,
  is_qualified      BOOLEAN NOT NULL DEFAULT false,
  payout            NUMERIC(8,2) NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','qualified','rejected','disputed')),
  caller_city       TEXT,
  caller_state      TEXT,
  caller_zip        TEXT,
  subid1            TEXT,
  subid2            TEXT,
  subid3            TEXT,
  subid4            TEXT,
  subid5            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alerts (Agent 7)
CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id         UUID REFERENCES pages(id),
  alert_type      TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  message         TEXT NOT NULL,
  metric_name     TEXT,
  threshold_value NUMERIC,
  actual_value    NUMERIC,
  is_resolved     BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_unresolved ON alerts (is_resolved) WHERE is_resolved = false;
CREATE INDEX idx_alerts_page ON alerts (page_id);

-- Optimization actions (Agent 7 output)
CREATE TABLE optimization_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id         UUID REFERENCES pages(id),
  alert_id        UUID REFERENCES alerts(id),
  action_type     TEXT NOT NULL,
  target_agent    TEXT NOT NULL,
  trigger_reason  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','dispatched','completed','skipped')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

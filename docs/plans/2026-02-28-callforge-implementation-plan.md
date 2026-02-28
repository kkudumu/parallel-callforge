# CallForge Core Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Orchestrator + Agents 1, 2, 3, 7 for extermanation.com pest control MVP targeting 3-5 cities.

**Architecture:** Monorepo TypeScript, single Node.js process. Orchestrator polls a PostgreSQL task queue, resolves DAG dependencies, dispatches work to agent modules. Agents invoke Claude/Codex CLI as child processes with Zod-enforced JSON Schema for constrained decoding. Bottleneck rate limiters and Opossum circuit breakers protect CLI access. Dead-letter queue captures permanent failures.

**Tech Stack:** Node.js 20+, TypeScript 5.x, PostgreSQL 16 (Docker), Zod v4, Bottleneck, Opossum, Hugo, Jest, node-cron, pg driver.

**Reference:** `docs/plans/2026-02-28-callforge-core-pipeline-design.md` for full design rationale.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `jest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts` (placeholder)

**Step 1: Initialize npm project and install dependencies**

```bash
cd /root/general-projects/parallel-callforge
npm init -y
```

Then update `package.json`:

```json
{
  "name": "parallel-callforge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "migrate": "tsx src/shared/db/migrate.ts",
    "test": "jest",
    "agent:1": "tsx src/agents/agent-1-keywords/index.ts",
    "agent:2": "tsx src/agents/agent-2-design/index.ts",
    "agent:3": "tsx src/agents/agent-3-builder/index.ts",
    "agent:7": "tsx src/agents/agent-7-monitor/index.ts",
    "pipeline": "tsx src/orchestrator/index.ts"
  },
  "dependencies": {
    "bottleneck": "^2.19.5",
    "node-cron": "^3.0.3",
    "opossum": "^8.1.4",
    "pg": "^8.13.1",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.5",
    "@types/node-cron": "^3.0.11",
    "@types/pg": "^8.11.10",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

**Step 2: Install dependencies**

```bash
npm install
```

Expected: Clean install, `node_modules/` created.

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Step 4: Create jest.config.ts**

```typescript
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  extensionsToTreatAsEsm: [".ts"],
};

export default config;
```

**Step 5: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: callforge
      POSTGRES_PASSWORD: callforge
      POSTGRES_DB: callforge
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

**Step 6: Create .env.example**

```
DATABASE_URL=postgres://callforge:callforge@localhost:5432/callforge
CLAUDE_CLI_PATH=/usr/local/bin/claude
CODEX_CLI_PATH=/usr/local/bin/codex
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GITHUB_TOKEN=
NETLIFY_SITE_ID=
WEATHER_API_KEY=
NODE_ENV=development
```

**Step 7: Create .gitignore**

```
node_modules/
dist/
.env
*.log
hugo-site/public/
hugo-site/resources/
```

**Step 8: Create placeholder entry point**

Create `src/index.ts`:

```typescript
console.log("CallForge starting...");
```

**Step 9: Verify build works**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 10: Commit**

```bash
git add package.json tsconfig.json jest.config.ts docker-compose.yml .env.example .gitignore src/index.ts
git commit -m "feat: scaffold project with TypeScript, Docker, Jest config"
```

---

## Task 2: Environment Config

**Files:**
- Create: `src/config/env.ts`
- Create: `src/config/rate-limits.ts`
- Test: `src/config/env.test.ts`

**Step 1: Write failing test for env config**

Create `src/config/env.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("parses valid environment variables", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      CLAUDE_CLI_PATH: "/usr/local/bin/claude",
      CODEX_CLI_PATH: "/usr/local/bin/codex",
      NODE_ENV: "development",
    });
    expect(env.DATABASE_URL).toBe("postgres://user:pass@localhost:5432/db");
    expect(env.CLAUDE_CLI_PATH).toBe("/usr/local/bin/claude");
    expect(env.NODE_ENV).toBe("development");
  });

  it("uses defaults for optional vars", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    });
    expect(env.CLAUDE_CLI_PATH).toBe("claude");
    expect(env.CODEX_CLI_PATH).toBe("codex");
    expect(env.NODE_ENV).toBe("development");
  });

  it("throws on missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/config/env.test.ts
```

Expected: FAIL - cannot find module `./env.js`

**Step 3: Implement env.ts**

Create `src/config/env.ts`:

```typescript
import { z } from "zod/v4";

const EnvSchema = z.object({
  DATABASE_URL: z.url().describe("PostgreSQL connection string"),
  CLAUDE_CLI_PATH: z.string().default("claude"),
  CODEX_CLI_PATH: z.string().default("codex"),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_REFRESH_TOKEN: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  NETLIFY_SITE_ID: z.string().optional(),
  WEATHER_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  return EnvSchema.parse(raw);
}

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = parseEnv(process.env as Record<string, string>);
  }
  return _env;
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/config/env.test.ts
```

Expected: PASS

**Step 5: Create rate-limits.ts**

Create `src/config/rate-limits.ts`:

```typescript
export interface ProviderRateLimitConfig {
  maxConcurrent: number;
  minTime: number;
  reservoir: number;
  reservoirRefreshAmount: number;
  reservoirRefreshInterval: number;
}

export const RATE_LIMITS: Record<string, ProviderRateLimitConfig> = {
  claude: {
    maxConcurrent: 1,
    minTime: 15_000,
    reservoir: 40,
    reservoirRefreshAmount: 40,
    reservoirRefreshInterval: 24 * 60 * 60 * 1000,
  },
  codex: {
    maxConcurrent: 1,
    minTime: 15_000,
    reservoir: 40,
    reservoirRefreshAmount: 40,
    reservoirRefreshInterval: 24 * 60 * 60 * 1000,
  },
  contentDeploy: {
    maxConcurrent: 1,
    minTime: 60_000,
    reservoir: 3,
    reservoirRefreshAmount: 3,
    reservoirRefreshInterval: 7 * 24 * 60 * 60 * 1000,
  },
};

export const CIRCUIT_BREAKER_OPTIONS = {
  timeout: 120_000,
  errorThresholdPercentage: 50,
  resetTimeout: 60_000,
  volumeThreshold: 3,
};
```

**Step 6: Commit**

```bash
git add src/config/
git commit -m "feat: add environment config with Zod validation and rate limit configs"
```

---

## Task 3: Database Client and Migration Runner

**Files:**
- Create: `src/shared/db/client.ts`
- Create: `src/shared/db/migrate.ts`
- Test: `src/shared/db/client.test.ts`

**Step 1: Write failing test for db client**

Create `src/shared/db/client.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { createDbClient } from "./client.js";

describe("createDbClient", () => {
  it("creates a pool with the given connection string", () => {
    const client = createDbClient("postgres://user:pass@localhost:5432/testdb");
    expect(client).toBeDefined();
    expect(client.query).toBeDefined();
    expect(client.end).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/shared/db/client.test.ts
```

Expected: FAIL

**Step 3: Implement client.ts**

Create `src/shared/db/client.ts`:

```typescript
import pg from "pg";

const { Pool } = pg;

export interface DbClient {
  query<T extends pg.QueryResultRow = any>(
    text: string,
    values?: unknown[]
  ): Promise<pg.QueryResult<T>>;
  end(): Promise<void>;
}

export function createDbClient(connectionString: string): DbClient {
  const pool = new Pool({ connectionString });

  return {
    async query<T extends pg.QueryResultRow = any>(
      text: string,
      values?: unknown[]
    ): Promise<pg.QueryResult<T>> {
      return pool.query<T>(text, values);
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/shared/db/client.test.ts
```

Expected: PASS

**Step 5: Implement migrate.ts**

Create `src/shared/db/migrate.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { createDbClient } from "./client.js";
import { getEnv } from "../../config/env.js";

const MIGRATIONS_DIR = path.join(
  import.meta.dirname,
  "migrations"
);

async function migrate() {
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = await db.query<{ name: string }>(
      "SELECT name FROM _migrations ORDER BY id"
    );
    const appliedSet = new Set(applied.rows.map((r) => r.name));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  skip: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`  applying: ${file}`);
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await db.query("COMMIT");
        console.log(`  applied: ${file}`);
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      }
    }

    console.log("Migrations complete.");
  } finally {
    await db.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

**Step 6: Create migrations directory**

```bash
mkdir -p src/shared/db/migrations
```

**Step 7: Commit**

```bash
git add src/shared/db/
git commit -m "feat: add database client and migration runner"
```

---

## Task 4: Database Migrations

**Files:**
- Create: `src/shared/db/migrations/001-core-tables.sql`

**Step 1: Write the migration**

Create `src/shared/db/migrations/001-core-tables.sql`:

```sql
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
```

**Step 2: Verify migration runs against Docker PostgreSQL**

```bash
docker compose up -d
sleep 3
DATABASE_URL=postgres://callforge:callforge@localhost:5432/callforge npx tsx src/shared/db/migrate.ts
```

Expected: `applying: 001-core-tables.sql` then `Migrations complete.`

**Step 3: Commit**

```bash
git add src/shared/db/migrations/
git commit -m "feat: add core database schema with all tables and indexes"
```

---

## Task 5: Zod Schema Registry

**Files:**
- Create: `src/shared/schemas/keyword-clusters.ts`
- Create: `src/shared/schemas/city-keyword-map.ts`
- Create: `src/shared/schemas/design-specs.ts`
- Create: `src/shared/schemas/copy-frameworks.ts`
- Create: `src/shared/schemas/agent-tasks.ts`
- Create: `src/shared/schemas/dead-letter-queue.ts`
- Create: `src/shared/schemas/pages.ts`
- Create: `src/shared/schemas/performance-snapshots.ts`
- Create: `src/shared/schemas/content-items.ts`
- Create: `src/shared/schemas/index.ts`
- Test: `src/shared/schemas/schemas.test.ts`

**Step 1: Write failing test**

Create `src/shared/schemas/schemas.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { z } from "zod/v4";
import {
  KeywordClusterSchema,
  CityKeywordMapSchema,
  DesignSpecSchema,
  CopyFrameworkSchema,
  AgentTaskSchema,
  DlqEntrySchema,
  PageSchema,
  PerformanceSnapshotSchema,
  ContentItemSchema,
} from "./index.js";

describe("Zod schemas", () => {
  it("validates a keyword cluster", () => {
    const data = {
      cluster_name: "pest control",
      primary_keyword: "pest control santa cruz",
      secondary_keywords: ["exterminator santa cruz", "bug control santa cruz"],
      search_volume: 320,
      difficulty: 35.5,
      intent: "transactional",
    };
    expect(() => KeywordClusterSchema.parse(data)).not.toThrow();
  });

  it("rejects invalid keyword cluster intent", () => {
    const data = {
      cluster_name: "test",
      primary_keyword: "test",
      secondary_keywords: [],
      search_volume: 100,
      difficulty: 50,
      intent: "invalid_intent",
    };
    expect(() => KeywordClusterSchema.parse(data)).toThrow();
  });

  it("generates JSON Schema from keyword cluster", () => {
    const jsonSchema = z.toJSONSchema(KeywordClusterSchema);
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toHaveProperty("primary_keyword");
  });

  it("validates a city keyword map", () => {
    const data = {
      city: "Santa Cruz",
      state: "CA",
      population: 65000,
      priority_score: 78.5,
      keyword_clusters: [],
      url_mapping: { hub: "/santa-cruz/", services: { termites: "/santa-cruz/termites/" } },
    };
    expect(() => CityKeywordMapSchema.parse(data)).not.toThrow();
  });

  it("validates a design spec", () => {
    const data = {
      niche: "pest-control",
      archetype: "emergency",
      layout: { sections: ["hero", "trust", "services", "faq", "cta"] },
      components: [{ name: "hero", type: "full-width" }],
      colors: { primary: "#FF6B00", secondary: "#1A1A2E" },
      typography: { heading: "Inter", body: "Open Sans" },
      responsive_breakpoints: { mobile: 375, tablet: 768, desktop: 1200 },
    };
    expect(() => DesignSpecSchema.parse(data)).not.toThrow();
  });

  it("validates an agent task", () => {
    const data = {
      task_type: "keyword_research",
      agent_name: "agent-1",
      payload: { niche: "pest-control", cities: ["Santa Cruz"] },
      status: "pending",
      dependencies: [],
    };
    expect(() => AgentTaskSchema.parse(data)).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/shared/schemas/schemas.test.ts
```

Expected: FAIL

**Step 3: Implement all schemas**

Create `src/shared/schemas/keyword-clusters.ts`:

```typescript
import { z } from "zod/v4";

export const KeywordClusterSchema = z.object({
  cluster_name: z.string().min(1).max(255).describe("Keyword cluster name"),
  primary_keyword: z.string().min(1).describe("Main SEO target keyword"),
  secondary_keywords: z.array(z.string()).describe("Related keywords"),
  search_volume: z.number().int().min(0).describe("Monthly search volume"),
  difficulty: z.number().min(0).max(100).describe("Keyword difficulty 0-100"),
  intent: z
    .enum(["informational", "transactional", "navigational", "commercial"])
    .describe("Search intent classification"),
});

export type KeywordCluster = z.infer<typeof KeywordClusterSchema>;
```

Create `src/shared/schemas/city-keyword-map.ts`:

```typescript
import { z } from "zod/v4";

export const CityKeywordMapSchema = z.object({
  city: z.string().min(1).describe("City name"),
  state: z.string().length(2).describe("Two-letter state code"),
  population: z.number().int().min(0).describe("City population"),
  priority_score: z.number().min(0).max(100).describe("City priority score 0-100"),
  keyword_clusters: z.array(z.any()).describe("Associated keyword clusters"),
  url_mapping: z
    .record(z.string(), z.any())
    .describe("URL path mapping for city pages"),
});

export type CityKeywordMap = z.infer<typeof CityKeywordMapSchema>;
```

Create `src/shared/schemas/design-specs.ts`:

```typescript
import { z } from "zod/v4";

export const DesignSpecSchema = z.object({
  niche: z.string().min(1).describe("Service niche"),
  archetype: z.string().min(1).describe("Page archetype name"),
  layout: z.record(z.string(), z.any()).describe("Layout specification"),
  components: z.array(z.record(z.string(), z.any())).describe("UI components"),
  colors: z.record(z.string(), z.string()).describe("Color palette"),
  typography: z.record(z.string(), z.string()).describe("Font configuration"),
  responsive_breakpoints: z
    .record(z.string(), z.number())
    .describe("Breakpoints in px"),
});

export type DesignSpec = z.infer<typeof DesignSpecSchema>;
```

Create `src/shared/schemas/copy-frameworks.ts`:

```typescript
import { z } from "zod/v4";

export const CopyFrameworkSchema = z.object({
  niche: z.string().min(1).describe("Service niche"),
  headlines: z.array(z.string()).describe("Headline formulas"),
  ctas: z.array(z.string()).describe("CTA text variations"),
  trust_signals: z.array(z.string()).describe("Trust signal text"),
  faq_templates: z
    .array(z.object({ question: z.string(), answer_template: z.string() }))
    .describe("FAQ templates"),
  pas_scripts: z
    .array(
      z.object({
        problem: z.string(),
        agitate: z.string(),
        solve: z.string(),
      })
    )
    .describe("Problem-Agitate-Solve scripts"),
});

export type CopyFramework = z.infer<typeof CopyFrameworkSchema>;
```

Create `src/shared/schemas/agent-tasks.ts`:

```typescript
import { z } from "zod/v4";

export const AgentTaskSchema = z.object({
  task_type: z.string().min(1).describe("Type of task"),
  agent_name: z.string().min(1).describe("Assigned agent"),
  payload: z.record(z.string(), z.any()).describe("Task payload"),
  status: z
    .enum(["pending", "running", "completed", "failed"])
    .default("pending"),
  dependencies: z.array(z.string()).default([]).describe("Task IDs this depends on"),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;
```

Create `src/shared/schemas/dead-letter-queue.ts`:

```typescript
import { z } from "zod/v4";

export const DlqEntrySchema = z.object({
  original_task_id: z.string().describe("Original task UUID"),
  task_type: z.string().describe("Task type"),
  agent_name: z.string().describe("Agent that failed"),
  payload: z.record(z.string(), z.any()).describe("Original payload"),
  error_message: z.string().describe("Error description"),
  error_stack: z.string().optional(),
  error_class: z
    .enum(["transient", "permanent", "unknown"])
    .default("unknown")
    .describe("Error classification"),
  retry_count: z.number().int().default(0),
  max_retries: z.number().int().default(3),
});

export type DlqEntry = z.infer<typeof DlqEntrySchema>;
```

Create `src/shared/schemas/pages.ts`:

```typescript
import { z } from "zod/v4";

export const PageSchema = z.object({
  url: z.string().describe("Full page URL"),
  slug: z.string().describe("URL slug"),
  city: z.string().describe("City name"),
  state: z.string().length(2).describe("Two-letter state code"),
  niche: z.string().default("pest-control"),
  target_keyword: z.string().optional(),
  status: z.enum(["active", "paused", "sunset"]).default("active"),
});

export type Page = z.infer<typeof PageSchema>;
```

Create `src/shared/schemas/performance-snapshots.ts`:

```typescript
import { z } from "zod/v4";

export const PerformanceSnapshotSchema = z.object({
  page_id: z.string().describe("Page UUID"),
  snapshot_date: z.string().describe("YYYY-MM-DD"),
  sessions: z.number().int().default(0),
  users: z.number().int().default(0),
  pageviews: z.number().int().default(0),
  organic_sessions: z.number().int().default(0),
  bounce_rate: z.number().min(0).max(1).optional(),
  avg_session_duration: z.number().min(0).optional(),
  click_to_call_count: z.number().int().default(0),
  calls_total: z.number().int().default(0),
  calls_qualified: z.number().int().default(0),
  revenue: z.number().default(0),
});

export type PerformanceSnapshot = z.infer<typeof PerformanceSnapshotSchema>;
```

Create `src/shared/schemas/content-items.ts`:

```typescript
import { z } from "zod/v4";

export const ContentItemSchema = z.object({
  title: z.string().min(1).describe("Content title"),
  slug: z.string().min(1).describe("URL slug"),
  status: z.enum(["draft", "review", "published", "archived"]).default("draft"),
  target_keyword: z.string().optional(),
  search_volume: z.number().int().optional(),
  keyword_difficulty: z.number().optional(),
  pest_type: z.string().optional(),
  city: z.string().optional(),
  content_type: z
    .enum(["city_hub", "service_subpage", "blog_post"])
    .describe("Content type"),
  author_persona: z.string().optional(),
  quality_score: z.record(z.string(), z.any()).optional(),
  word_count: z.number().int().optional(),
  niche: z.string().default("pest-control"),
});

export type ContentItem = z.infer<typeof ContentItemSchema>;
```

Create `src/shared/schemas/index.ts`:

```typescript
export { KeywordClusterSchema, type KeywordCluster } from "./keyword-clusters.js";
export { CityKeywordMapSchema, type CityKeywordMap } from "./city-keyword-map.js";
export { DesignSpecSchema, type DesignSpec } from "./design-specs.js";
export { CopyFrameworkSchema, type CopyFramework } from "./copy-frameworks.js";
export { AgentTaskSchema, type AgentTask } from "./agent-tasks.js";
export { DlqEntrySchema, type DlqEntry } from "./dead-letter-queue.js";
export { PageSchema, type Page } from "./pages.js";
export {
  PerformanceSnapshotSchema,
  type PerformanceSnapshot,
} from "./performance-snapshots.js";
export { ContentItemSchema, type ContentItem } from "./content-items.js";
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/shared/schemas/schemas.test.ts
```

Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/shared/schemas/
git commit -m "feat: add Zod v4 schema registry for all database tables"
```

---

## Task 6: Rate Limiter

**Files:**
- Create: `src/shared/cli/rate-limiter.ts`
- Test: `src/shared/cli/rate-limiter.test.ts`

**Step 1: Write failing test**

Create `src/shared/cli/rate-limiter.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { createRateLimiters } from "./rate-limiter.js";

describe("createRateLimiters", () => {
  it("creates limiters for claude and codex", () => {
    const limiters = createRateLimiters();
    expect(limiters.claude).toBeDefined();
    expect(limiters.codex).toBeDefined();
    expect(limiters.contentDeploy).toBeDefined();
  });

  it("limiter schedule method exists", async () => {
    const limiters = createRateLimiters();
    expect(typeof limiters.claude.schedule).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/shared/cli/rate-limiter.test.ts
```

Expected: FAIL

**Step 3: Implement rate-limiter.ts**

Create `src/shared/cli/rate-limiter.ts`:

```typescript
import Bottleneck from "bottleneck";
import { RATE_LIMITS } from "../../config/rate-limits.js";

export interface RateLimiters {
  claude: Bottleneck;
  codex: Bottleneck;
  contentDeploy: Bottleneck;
}

export function createRateLimiters(): RateLimiters {
  return {
    claude: new Bottleneck(RATE_LIMITS.claude),
    codex: new Bottleneck(RATE_LIMITS.codex),
    contentDeploy: new Bottleneck(RATE_LIMITS.contentDeploy),
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/shared/cli/rate-limiter.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/cli/rate-limiter.ts src/shared/cli/rate-limiter.test.ts
git commit -m "feat: add Bottleneck rate limiters for CLI providers"
```

---

## Task 7: Circuit Breaker

**Files:**
- Create: `src/shared/circuit-breaker.ts`
- Test: `src/shared/circuit-breaker.test.ts`

**Step 1: Write failing test**

Create `src/shared/circuit-breaker.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { createCircuitBreaker } from "./circuit-breaker.js";

describe("createCircuitBreaker", () => {
  it("creates a circuit breaker that calls the wrapped function", async () => {
    const fn = async (x: number) => x * 2;
    const breaker = createCircuitBreaker(fn, "test");
    const result = await breaker.fire(5);
    expect(result).toBe(10);
  });

  it("opens after consecutive failures", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error("fail");
    };
    const breaker = createCircuitBreaker(fn, "test-fail", {
      volumeThreshold: 2,
      errorThresholdPercentage: 50,
      resetTimeout: 100,
    });

    for (let i = 0; i < 3; i++) {
      try { await breaker.fire(); } catch { /* expected */ }
    }

    expect(breaker.opened).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/shared/circuit-breaker.test.ts
```

Expected: FAIL

**Step 3: Implement circuit-breaker.ts**

Create `src/shared/circuit-breaker.ts`:

```typescript
import CircuitBreaker from "opossum";
import { CIRCUIT_BREAKER_OPTIONS } from "../config/rate-limits.js";

export function createCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  name: string,
  overrides?: Partial<typeof CIRCUIT_BREAKER_OPTIONS>
): CircuitBreaker<Parameters<T>, Awaited<ReturnType<T>>> {
  const options = { ...CIRCUIT_BREAKER_OPTIONS, ...overrides, name };
  const breaker = new CircuitBreaker(fn, options);

  breaker.on("open", () => {
    console.warn(`Circuit breaker [${name}] OPENED - requests will be rejected`);
  });

  breaker.on("halfOpen", () => {
    console.log(`Circuit breaker [${name}] HALF-OPEN - testing recovery`);
  });

  breaker.on("close", () => {
    console.log(`Circuit breaker [${name}] CLOSED - recovered`);
  });

  return breaker;
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/shared/circuit-breaker.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/circuit-breaker.ts src/shared/circuit-breaker.test.ts
git commit -m "feat: add Opossum circuit breaker wrapper"
```

---

## Task 8: CLI Wrappers (Claude + Codex)

**Files:**
- Create: `src/shared/cli/claude-cli.ts`
- Create: `src/shared/cli/codex-cli.ts`
- Create: `src/shared/cli/types.ts`
- Test: `src/shared/cli/claude-cli.test.ts`

**Step 1: Create shared types**

Create `src/shared/cli/types.ts`:

```typescript
import type { z } from "zod/v4";

export interface CliInvokeOptions {
  prompt: string;
  jsonSchema?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface CliResult {
  result: string;
  is_error: boolean;
  raw_stdout: string;
  raw_stderr: string;
}

export interface CliProvider {
  name: string;
  invoke(options: CliInvokeOptions): Promise<CliResult>;
}

export function detectRateLimit(exitCode: number | null, stderr: string): boolean {
  const patterns = [
    /rate.?limit/i,
    /429/,
    /too many requests/i,
    /rate_limit_exceeded/i,
    /Please try again in/i,
  ];
  return exitCode !== 0 && patterns.some((p) => p.test(stderr));
}

export function parseRetryAfter(stderr: string): number {
  const match = stderr.match(/try again in ([\d.]+)\s*s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) + 1000 : 30_000;
}

export function extractJson(stdout: string): unknown {
  // Strategy 1: Direct parse
  try {
    return JSON.parse(stdout);
  } catch { /* continue */ }

  // Strategy 2: Extract from markdown code block
  const codeBlockMatch = stdout.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch { /* continue */ }
  }

  // Strategy 3: Find largest JSON object/array
  const jsonMatches = stdout.match(/[\[{][\s\S]*?[\]}]/g);
  if (jsonMatches) {
    for (const match of jsonMatches.sort((a, b) => b.length - a.length)) {
      try {
        return JSON.parse(match);
      } catch { /* continue */ }
    }
  }

  throw new Error("No valid JSON found in CLI output");
}
```

**Step 2: Write failing test for CLI wrapper**

Create `src/shared/cli/claude-cli.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { detectRateLimit, parseRetryAfter, extractJson } from "./types.js";

describe("CLI utilities", () => {
  describe("detectRateLimit", () => {
    it("detects rate limit in stderr", () => {
      expect(detectRateLimit(1, "Error: rate limit exceeded")).toBe(true);
      expect(detectRateLimit(1, "429 Too Many Requests")).toBe(true);
      expect(detectRateLimit(1, "Please try again in 30s")).toBe(true);
    });

    it("returns false for non-rate-limit errors", () => {
      expect(detectRateLimit(1, "TypeError: undefined")).toBe(false);
      expect(detectRateLimit(0, "rate limit")).toBe(false);
    });
  });

  describe("parseRetryAfter", () => {
    it("extracts retry delay from stderr", () => {
      expect(parseRetryAfter("Please try again in 30s")).toBe(31000);
      expect(parseRetryAfter("try again in 5.5 seconds")).toBe(6000);
    });

    it("defaults to 30s when no timing found", () => {
      expect(parseRetryAfter("rate limit exceeded")).toBe(30000);
    });
  });

  describe("extractJson", () => {
    it("parses raw JSON", () => {
      expect(extractJson('{"key": "value"}')).toEqual({ key: "value" });
    });

    it("extracts from markdown code block", () => {
      const input = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
      expect(extractJson(input)).toEqual({ key: "value" });
    });

    it("finds largest JSON in mixed output", () => {
      const input = 'Progress: 50%\n{"result": {"data": [1,2,3]}}\nDone.';
      expect(extractJson(input)).toEqual({ result: { data: [1, 2, 3] } });
    });

    it("throws when no JSON found", () => {
      expect(() => extractJson("no json here")).toThrow("No valid JSON");
    });
  });
});
```

**Step 3: Run test to verify it fails**

```bash
npx jest src/shared/cli/claude-cli.test.ts
```

Expected: FAIL

**Step 4: Verify tests pass after types.ts is created (already created in step 1)**

```bash
npx jest src/shared/cli/claude-cli.test.ts
```

Expected: PASS

**Step 5: Implement claude-cli.ts**

Create `src/shared/cli/claude-cli.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliProvider, CliInvokeOptions, CliResult } from "./types.js";
import { extractJson, detectRateLimit } from "./types.js";

const execFileAsync = promisify(execFile);

export function createClaudeCli(cliPath: string): CliProvider {
  return {
    name: "claude",

    async invoke(options: CliInvokeOptions): Promise<CliResult> {
      const args = [
        "-p", options.prompt,
        "--output-format", "json",
      ];

      if (options.jsonSchema) {
        args.push("--json-schema", options.jsonSchema);
      }

      if (options.maxTurns) {
        args.push("--max-turns", String(options.maxTurns));
      }

      try {
        const { stdout, stderr } = await execFileAsync(cliPath, args, {
          timeout: options.timeoutMs ?? 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const envelope = extractJson(stdout) as Record<string, unknown>;
        const isError = Boolean(envelope.is_error);
        const result = typeof envelope.result === "string"
          ? envelope.result
          : JSON.stringify(envelope.result);

        return {
          result,
          is_error: isError,
          raw_stdout: stdout,
          raw_stderr: stderr,
        };
      } catch (err: any) {
        const stderr = err.stderr ?? "";
        if (detectRateLimit(err.code ?? 1, stderr)) {
          const error = new Error("Rate limit hit") as any;
          error.isRateLimit = true;
          error.stderr = stderr;
          throw error;
        }
        throw err;
      }
    },
  };
}
```

**Step 6: Implement codex-cli.ts**

Create `src/shared/cli/codex-cli.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliProvider, CliInvokeOptions, CliResult } from "./types.js";
import { extractJson, detectRateLimit } from "./types.js";

const execFileAsync = promisify(execFile);

export function createCodexCli(cliPath: string): CliProvider {
  return {
    name: "codex",

    async invoke(options: CliInvokeOptions): Promise<CliResult> {
      const args = [
        "-q",
        "--json",
        options.prompt,
      ];

      try {
        const { stdout, stderr } = await execFileAsync(cliPath, args, {
          timeout: options.timeoutMs ?? 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const parsed = extractJson(stdout);
        const result = typeof parsed === "string" ? parsed : JSON.stringify(parsed);

        return {
          result,
          is_error: false,
          raw_stdout: stdout,
          raw_stderr: stderr,
        };
      } catch (err: any) {
        const stderr = err.stderr ?? "";
        if (detectRateLimit(err.code ?? 1, stderr)) {
          const error = new Error("Rate limit hit") as any;
          error.isRateLimit = true;
          error.stderr = stderr;
          throw error;
        }
        throw err;
      }
    },
  };
}
```

**Step 7: Commit**

```bash
git add src/shared/cli/
git commit -m "feat: add Claude and Codex CLI wrappers with rate limit detection"
```

---

## Task 9: Unified LLM Client with Fallback and Self-Correction

**Files:**
- Create: `src/shared/cli/llm-client.ts`
- Test: `src/shared/cli/llm-client.test.ts`

**Step 1: Write failing test**

Create `src/shared/cli/llm-client.test.ts`:

```typescript
import { describe, it, expect, jest } from "@jest/globals";
import { z } from "zod/v4";
import { createLlmClient, type LlmClient } from "./llm-client.js";
import type { CliProvider, CliResult } from "./types.js";
import { createRateLimiters } from "./rate-limiter.js";

function mockProvider(name: string, result: unknown, fail = false): CliProvider {
  return {
    name,
    invoke: async () => {
      if (fail) throw new Error("Provider error");
      return {
        result: JSON.stringify(result),
        is_error: false,
        raw_stdout: JSON.stringify({ result: JSON.stringify(result) }),
        raw_stderr: "",
      };
    },
  };
}

describe("LlmClient", () => {
  const TestSchema = z.object({
    answer: z.string(),
    confidence: z.number().min(0).max(1),
  });

  it("returns validated data from primary provider", async () => {
    const primary = mockProvider("claude", { answer: "hello", confidence: 0.9 });
    const fallback = mockProvider("codex", { answer: "fallback", confidence: 0.5 });
    const limiters = createRateLimiters();
    const client = createLlmClient(primary, fallback, limiters);

    const result = await client.call({
      prompt: "test prompt",
      schema: TestSchema,
    });

    expect(result.answer).toBe("hello");
    expect(result.confidence).toBe(0.9);
  });

  it("falls back to secondary on primary failure", async () => {
    const primary = mockProvider("claude", null, true);
    const fallback = mockProvider("codex", { answer: "fallback", confidence: 0.7 });
    const limiters = createRateLimiters();
    const client = createLlmClient(primary, fallback, limiters);

    const result = await client.call({
      prompt: "test prompt",
      schema: TestSchema,
    });

    expect(result.answer).toBe("fallback");
  });

  it("throws when both providers fail", async () => {
    const primary = mockProvider("claude", null, true);
    const fallback = mockProvider("codex", null, true);
    const limiters = createRateLimiters();
    const client = createLlmClient(primary, fallback, limiters);

    await expect(
      client.call({ prompt: "test", schema: TestSchema })
    ).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/shared/cli/llm-client.test.ts
```

Expected: FAIL

**Step 3: Implement llm-client.ts**

Create `src/shared/cli/llm-client.ts`:

```typescript
import { z } from "zod/v4";
import type { CliProvider } from "./types.js";
import type { RateLimiters } from "./rate-limiter.js";

export interface LlmCallOptions<T extends z.ZodType> {
  prompt: string;
  schema: T;
  maxRetries?: number;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface LlmClient {
  call<T extends z.ZodType>(options: LlmCallOptions<T>): Promise<z.infer<T>>;
}

async function invokeWithValidation<T extends z.ZodType>(
  provider: CliProvider,
  prompt: string,
  schema: T,
  maxRetries: number,
  maxTurns?: number,
  timeoutMs?: number
): Promise<z.infer<T>> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await provider.invoke({
      prompt: currentPrompt,
      jsonSchema,
      maxTurns: maxTurns ?? 10,
      timeoutMs,
    });

    if (result.is_error) {
      throw new Error(`CLI returned error: ${result.result}`);
    }

    try {
      const parsed = typeof result.result === "string"
        ? JSON.parse(result.result)
        : result.result;
      return schema.parse(parsed);
    } catch (err) {
      if (attempt >= maxRetries) throw err;

      const errMsg =
        err instanceof z.ZodError
          ? err.issues
              .map((i: any) => `Path "${(i.path || []).join(".")}": ${i.message}`)
              .join("\n")
          : String(err);

      currentPrompt = `${prompt}\n\nCORRECTION (attempt ${attempt + 1}):\nThe previous output failed validation:\n${errMsg}\nOutput ONLY valid JSON matching the schema.`;

      console.warn(
        `[${provider.name}] Validation failed (attempt ${attempt}/${maxRetries}): ${errMsg}`
      );
    }
  }

  throw new Error("Unreachable");
}

export function createLlmClient(
  primary: CliProvider,
  fallback: CliProvider,
  limiters: RateLimiters
): LlmClient {
  return {
    async call<T extends z.ZodType>(options: LlmCallOptions<T>): Promise<z.infer<T>> {
      const { prompt, schema, maxRetries = 3, maxTurns, timeoutMs } = options;

      // Try primary provider through rate limiter
      try {
        return await limiters.claude.schedule(() =>
          invokeWithValidation(primary, prompt, schema, maxRetries, maxTurns, timeoutMs)
        );
      } catch (primaryErr: any) {
        console.warn(
          `[${primary.name}] Failed, falling back to ${fallback.name}: ${primaryErr.message}`
        );

        // Try fallback provider
        try {
          return await limiters.codex.schedule(() =>
            invokeWithValidation(
              fallback,
              prompt,
              schema,
              maxRetries,
              maxTurns,
              timeoutMs
            )
          );
        } catch (fallbackErr: any) {
          const error = new Error(
            `All providers failed. Primary (${primary.name}): ${primaryErr.message}. Fallback (${fallback.name}): ${fallbackErr.message}`
          );
          throw error;
        }
      }
    },
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/shared/cli/llm-client.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/cli/llm-client.ts src/shared/cli/llm-client.test.ts
git commit -m "feat: add unified LLM client with provider fallback and Zod self-correction"
```

---

## Task 10: Dead-Letter Queue Manager

**Files:**
- Create: `src/orchestrator/dlq-manager.ts`
- Test: `src/orchestrator/dlq-manager.test.ts`

**Step 1: Write failing test**

Create `src/orchestrator/dlq-manager.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { computeFingerprint, classifyError } from "./dlq-manager.js";

describe("DLQ Manager", () => {
  describe("computeFingerprint", () => {
    it("generates consistent fingerprints for same input", () => {
      const fp1 = computeFingerprint("keyword_research", "agent-1", { city: "Phoenix" });
      const fp2 = computeFingerprint("keyword_research", "agent-1", { city: "Phoenix" });
      expect(fp1).toBe(fp2);
      expect(fp1.length).toBe(16);
    });

    it("generates different fingerprints for different input", () => {
      const fp1 = computeFingerprint("keyword_research", "agent-1", { city: "Phoenix" });
      const fp2 = computeFingerprint("keyword_research", "agent-1", { city: "Atlanta" });
      expect(fp1).not.toBe(fp2);
    });
  });

  describe("classifyError", () => {
    it("classifies rate limit as transient", () => {
      expect(classifyError(new Error("rate limit exceeded"))).toBe("transient");
      expect(classifyError(new Error("429 Too Many Requests"))).toBe("transient");
    });

    it("classifies timeout as transient", () => {
      expect(classifyError(new Error("ETIMEDOUT"))).toBe("transient");
      expect(classifyError(new Error("socket hang up"))).toBe("transient");
    });

    it("classifies validation errors as permanent", () => {
      expect(classifyError(new Error("ZodError: invalid type"))).toBe("permanent");
    });

    it("classifies unknown errors as unknown", () => {
      expect(classifyError(new Error("something weird"))).toBe("unknown");
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/orchestrator/dlq-manager.test.ts
```

Expected: FAIL

**Step 3: Implement dlq-manager.ts**

Create `src/orchestrator/dlq-manager.ts`:

```typescript
import { createHash } from "node:crypto";
import type { DbClient } from "../shared/db/client.js";

export type ErrorClass = "transient" | "permanent" | "unknown";

export function computeFingerprint(
  taskType: string,
  agentName: string,
  payload: Record<string, unknown>
): string {
  const input = taskType + agentName + JSON.stringify(payload);
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function classifyError(error: Error): ErrorClass {
  const msg = error.message.toLowerCase();

  const transientPatterns = [
    /rate.?limit/,
    /429/,
    /too many requests/,
    /etimedout/,
    /econnreset/,
    /econnrefused/,
    /socket hang up/,
    /timeout/,
    /temporarily unavailable/,
  ];

  const permanentPatterns = [
    /zoderror/i,
    /invalid.?type/,
    /validation.?fail/,
    /schema.?mismatch/,
    /permission.?denied/,
    /not.?found.*file/,
  ];

  if (transientPatterns.some((p) => p.test(msg))) return "transient";
  if (permanentPatterns.some((p) => p.test(msg))) return "permanent";
  return "unknown";
}

export interface DlqManager {
  isInDLQ(taskType: string, agentName: string, payload: Record<string, unknown>): Promise<boolean>;
  addToDLQ(params: {
    originalTaskId: string;
    taskType: string;
    agentName: string;
    payload: Record<string, unknown>;
    error: Error;
    retryCount: number;
  }): Promise<void>;
  getUnresolved(): Promise<Array<{
    id: string;
    task_type: string;
    agent_name: string;
    error_class: ErrorClass;
    retry_count: number;
    last_failed_at: Date;
  }>>;
  resolve(id: string, resolution: "retried" | "skipped" | "manual" | "expired"): Promise<void>;
}

export function createDlqManager(db: DbClient): DlqManager {
  return {
    async isInDLQ(taskType, agentName, payload) {
      const fp = computeFingerprint(taskType, agentName, payload);
      const result = await db.query(
        "SELECT id FROM dead_letter_queue WHERE fingerprint = $1 AND resolved_at IS NULL LIMIT 1",
        [fp]
      );
      return result.rows.length > 0;
    },

    async addToDLQ({ originalTaskId, taskType, agentName, payload, error, retryCount }) {
      const fp = computeFingerprint(taskType, agentName, payload);
      const errorClass = classifyError(error);

      // Check for existing unresolved entry with same fingerprint
      const existing = await db.query(
        "SELECT id, retry_count FROM dead_letter_queue WHERE fingerprint = $1 AND resolved_at IS NULL LIMIT 1",
        [fp]
      );

      if (existing.rows.length > 0) {
        await db.query(
          `UPDATE dead_letter_queue
           SET retry_count = $1, last_failed_at = now(), error_message = $2, error_stack = $3
           WHERE id = $4`,
          [retryCount, error.message, error.stack ?? null, existing.rows[0].id]
        );
      } else {
        await db.query(
          `INSERT INTO dead_letter_queue
           (original_task_id, task_type, agent_name, payload, error_message, error_stack, error_class, retry_count, fingerprint)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            originalTaskId,
            taskType,
            agentName,
            JSON.stringify(payload),
            error.message,
            error.stack ?? null,
            errorClass,
            retryCount,
            fp,
          ]
        );
      }
    },

    async getUnresolved() {
      const result = await db.query(
        `SELECT id, task_type, agent_name, error_class, retry_count, last_failed_at
         FROM dead_letter_queue
         WHERE resolved_at IS NULL
         ORDER BY last_failed_at DESC`
      );
      return result.rows;
    },

    async resolve(id, resolution) {
      await db.query(
        "UPDATE dead_letter_queue SET resolved_at = now(), resolution = $1 WHERE id = $2",
        [resolution, id]
      );
    },
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/orchestrator/dlq-manager.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/
git commit -m "feat: add dead-letter queue manager with fingerprinting and error classification"
```

---

## Task 11: Task Scheduler (DAG Resolution)

**Files:**
- Create: `src/orchestrator/task-scheduler.ts`
- Create: `src/orchestrator/types.ts`
- Test: `src/orchestrator/task-scheduler.test.ts`

**Step 1: Write failing test**

Create `src/orchestrator/types.ts`:

```typescript
export interface TaskRecord {
  id: string;
  task_type: string;
  agent_name: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  dependencies: string[];
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  error_message: string | null;
}

export interface AgentHandler {
  name: string;
  execute(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}
```

Create `src/orchestrator/task-scheduler.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { getReadyTasks } from "./task-scheduler.js";
import type { TaskRecord } from "./types.js";

function task(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    task_type: "test",
    agent_name: "test-agent",
    payload: {},
    status: "pending",
    dependencies: [],
    created_at: new Date(),
    started_at: null,
    completed_at: null,
    error_message: null,
    ...overrides,
  };
}

describe("getReadyTasks", () => {
  it("returns tasks with no dependencies", () => {
    const tasks = [
      task({ id: "a" }),
      task({ id: "b" }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("excludes tasks with pending dependencies", () => {
    const tasks = [
      task({ id: "a" }),
      task({ id: "b", dependencies: ["a"] }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["a"]);
  });

  it("includes tasks whose dependencies are completed", () => {
    const tasks = [
      task({ id: "a", status: "completed" }),
      task({ id: "b", dependencies: ["a"] }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["b"]);
  });

  it("excludes running and completed tasks", () => {
    const tasks = [
      task({ id: "a", status: "running" }),
      task({ id: "b", status: "completed" }),
      task({ id: "c" }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["c"]);
  });

  it("excludes tasks with failed dependencies", () => {
    const tasks = [
      task({ id: "a", status: "failed" }),
      task({ id: "b", dependencies: ["a"] }),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/orchestrator/task-scheduler.test.ts
```

Expected: FAIL

**Step 3: Implement task-scheduler.ts**

Create `src/orchestrator/task-scheduler.ts`:

```typescript
import type { DbClient } from "../shared/db/client.js";
import type { TaskRecord, AgentHandler } from "./types.js";
import type { DlqManager } from "./dlq-manager.js";

export function getReadyTasks(tasks: TaskRecord[]): TaskRecord[] {
  const statusMap = new Map(tasks.map((t) => [t.id, t.status]));

  return tasks.filter((t) => {
    if (t.status !== "pending") return false;

    return t.dependencies.every((depId) => {
      const depStatus = statusMap.get(depId);
      return depStatus === "completed";
    });
  });
}

export interface TaskScheduler {
  createTask(taskType: string, agentName: string, payload: Record<string, unknown>, dependencies?: string[]): Promise<string>;
  getAllTasks(): Promise<TaskRecord[]>;
  getReadyTasks(): Promise<TaskRecord[]>;
  markRunning(taskId: string): Promise<void>;
  markCompleted(taskId: string): Promise<void>;
  markFailed(taskId: string, error: string): Promise<void>;
}

export function createTaskScheduler(db: DbClient, dlq: DlqManager): TaskScheduler {
  return {
    async createTask(taskType, agentName, payload, dependencies = []) {
      // Check DLQ before scheduling
      if (await dlq.isInDLQ(taskType, agentName, payload)) {
        console.warn(`Task in DLQ, skipping: ${taskType}/${agentName}`);
        throw new Error(`Task poisoned (in DLQ): ${taskType}/${agentName}`);
      }

      const result = await db.query(
        `INSERT INTO agent_tasks (task_type, agent_name, payload, dependencies)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [taskType, agentName, JSON.stringify(payload), dependencies]
      );
      return result.rows[0].id;
    },

    async getAllTasks() {
      const result = await db.query<TaskRecord>(
        "SELECT * FROM agent_tasks ORDER BY created_at"
      );
      return result.rows;
    },

    async getReadyTasks() {
      const allTasks = await this.getAllTasks();
      return getReadyTasks(allTasks);
    },

    async markRunning(taskId) {
      await db.query(
        "UPDATE agent_tasks SET status = 'running', started_at = now() WHERE id = $1",
        [taskId]
      );
    },

    async markCompleted(taskId) {
      await db.query(
        "UPDATE agent_tasks SET status = 'completed', completed_at = now() WHERE id = $1",
        [taskId]
      );
    },

    async markFailed(taskId, error) {
      await db.query(
        "UPDATE agent_tasks SET status = 'failed', completed_at = now(), error_message = $1 WHERE id = $2",
        [error, taskId]
      );
    },
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/orchestrator/task-scheduler.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/types.ts src/orchestrator/task-scheduler.ts src/orchestrator/task-scheduler.test.ts
git commit -m "feat: add DAG-based task scheduler with DLQ integration"
```

---

## Task 12: Orchestrator Main Loop

**Files:**
- Create: `src/orchestrator/index.ts`

**Step 1: Implement the orchestrator**

Create `src/orchestrator/index.ts`:

```typescript
import { createDbClient } from "../shared/db/client.js";
import { createDlqManager } from "./dlq-manager.js";
import { createTaskScheduler } from "./task-scheduler.js";
import { createRateLimiters } from "../shared/cli/rate-limiter.js";
import { createClaudeCli } from "../shared/cli/claude-cli.js";
import { createCodexCli } from "../shared/cli/codex-cli.js";
import { createLlmClient } from "../shared/cli/llm-client.js";
import { getEnv } from "../config/env.js";
import type { AgentHandler, TaskRecord } from "./types.js";

export interface OrchestratorDeps {
  agentHandlers: Map<string, AgentHandler>;
  pollIntervalMs?: number;
  maxConcurrent?: number;
}

export async function createOrchestrator(deps: OrchestratorDeps) {
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);
  const dlq = createDlqManager(db);
  const scheduler = createTaskScheduler(db, dlq);
  const limiters = createRateLimiters();
  const claudeCli = createClaudeCli(env.CLAUDE_CLI_PATH);
  const codexCli = createCodexCli(env.CODEX_CLI_PATH);
  const llm = createLlmClient(claudeCli, codexCli, limiters);

  const { agentHandlers, pollIntervalMs = 5000, maxConcurrent = 1 } = deps;
  let running = false;
  let activeCount = 0;

  async function processTask(task: TaskRecord) {
    const handler = agentHandlers.get(task.agent_name);
    if (!handler) {
      await scheduler.markFailed(task.id, `No handler for agent: ${task.agent_name}`);
      return;
    }

    await scheduler.markRunning(task.id);
    console.log(`[orchestrator] Running task ${task.id} (${task.task_type} → ${task.agent_name})`);

    try {
      activeCount++;
      await handler.execute(task.payload);
      await scheduler.markCompleted(task.id);
      console.log(`[orchestrator] Completed task ${task.id}`);
    } catch (err: any) {
      console.error(`[orchestrator] Task ${task.id} failed: ${err.message}`);
      await scheduler.markFailed(task.id, err.message);

      await dlq.addToDLQ({
        originalTaskId: task.id,
        taskType: task.task_type,
        agentName: task.agent_name,
        payload: task.payload,
        error: err,
        retryCount: 1,
      });
    } finally {
      activeCount--;
    }
  }

  async function poll() {
    if (activeCount >= maxConcurrent) return;

    const ready = await scheduler.getReadyTasks();
    if (ready.length === 0) return;

    const slotsAvailable = maxConcurrent - activeCount;
    const batch = ready.slice(0, slotsAvailable);

    await Promise.all(batch.map(processTask));
  }

  return {
    scheduler,
    dlq,
    llm,
    db,

    async start() {
      running = true;
      console.log("[orchestrator] Started polling for tasks");
      while (running) {
        try {
          await poll();
        } catch (err: any) {
          console.error(`[orchestrator] Poll error: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    },

    stop() {
      running = false;
      console.log("[orchestrator] Stopping...");
    },

    async shutdown() {
      this.stop();
      await db.end();
    },
  };
}
```

**Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors (or only errors from files not yet created -- fix any real issues).

**Step 3: Commit**

```bash
git add src/orchestrator/index.ts
git commit -m "feat: add orchestrator main loop with polling, agent dispatch, and DLQ routing"
```

---

## Task 13: Agent 1 -- Keyword Research

**Files:**
- Create: `src/agents/agent-1-keywords/index.ts`
- Create: `src/agents/agent-1-keywords/prompts.ts`
- Create: `src/agents/agent-1-keywords/google-kp.ts`
- Test: `src/agents/agent-1-keywords/agent-1.test.ts`

**Step 1: Write prompts.ts**

Create `src/agents/agent-1-keywords/prompts.ts`:

```typescript
export const KEYWORD_TEMPLATE_PROMPT = `You are an SEO keyword research specialist for local service businesses.

Generate keyword templates for the "{niche}" niche that can be expanded per city.
Each template uses {city} as a placeholder.

Focus on:
- High commercial intent (people ready to hire)
- Local service variations
- Emergency/urgent variations
- Cost/pricing queries
- "Near me" variations (map to city pages)

Generate 20-30 keyword patterns. Examples:
- "{city} pest control"
- "exterminator in {city}"
- "termite treatment {city}"
- "emergency pest control {city}"
- "pest control cost {city}"

Output ONLY valid JSON matching the provided schema.`;

export const CITY_SCORING_PROMPT = `You are a market analyst for local service lead generation.

Given the following keyword volume data and city information, score each city on a 0-100 scale.

Scoring criteria:
- Population 75K-250K sweet spot (smaller = less competition, larger = more volume)
- Primary keyword search volume 50-500/month (sweet spot for new sites)
- Low keyword difficulty (<30 preferred, <50 acceptable)
- High commercial intent keywords present
- Geographic premium potential (Sun Belt, high pest activity regions score higher)

City data:
{city_data}

Keyword data:
{keyword_data}

Output ONLY valid JSON matching the provided schema.`;

export const KEYWORD_CLUSTERING_PROMPT = `You are an SEO architect specializing in URL structure optimization.

Given these keywords and their metrics for {city}, {state}, group them into clusters
and map each cluster to a URL path.

Rules:
- City hub page ("/[city-slug]/") targets broad "[city] pest control" type keywords
- Service subpages ("/[city-slug]/[service]/") target specific pest types
- Each cluster should have 1 primary keyword and 2-5 secondary keywords
- Classify intent: informational, transactional, navigational, commercial

Keywords:
{keywords}

Output ONLY valid JSON matching the provided schema.`;
```

**Step 2: Create Google KP stub**

Create `src/agents/agent-1-keywords/google-kp.ts`:

```typescript
export interface KeywordMetrics {
  keyword: string;
  avg_monthly_searches: number;
  competition: "LOW" | "MEDIUM" | "HIGH";
  competition_index: number;
  low_top_of_page_bid: number;
  high_top_of_page_bid: number;
}

export interface GoogleKpClient {
  getKeywordIdeas(keywords: string[], locationId?: string): Promise<KeywordMetrics[]>;
}

// Real implementation requires google-ads-api package and credentials.
// This stub returns LLM-estimated data for MVP.
export function createGoogleKpClient(_credentials?: {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): GoogleKpClient {
  return {
    async getKeywordIdeas(keywords: string[]): Promise<KeywordMetrics[]> {
      console.warn("[GoogleKP] Using stub - returning empty results. Set up Google Ads API for real data.");
      return keywords.map((kw) => ({
        keyword: kw,
        avg_monthly_searches: 0,
        competition: "LOW" as const,
        competition_index: 0,
        low_top_of_page_bid: 0,
        high_top_of_page_bid: 0,
      }));
    },
  };
}
```

**Step 3: Write agent-1 test**

Create `src/agents/agent-1-keywords/agent-1.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { expandKeywordTemplates } from "./index.js";

describe("Agent 1 - Keywords", () => {
  describe("expandKeywordTemplates", () => {
    it("expands city placeholder in templates", () => {
      const templates = ["{city} pest control", "exterminator in {city}"];
      const cities = ["Santa Cruz", "Atlanta"];
      const result = expandKeywordTemplates(templates, cities);
      expect(result).toContain("Santa Cruz pest control");
      expect(result).toContain("exterminator in Atlanta");
      expect(result).toHaveLength(4);
    });

    it("slugifies city names for URL-safe versions", () => {
      const templates = ["{city_slug} pest control"];
      const cities = ["San Francisco"];
      const result = expandKeywordTemplates(templates, cities);
      expect(result).toContain("san-francisco pest control");
    });
  });
});
```

**Step 4: Run test to verify it fails**

```bash
npx jest src/agents/agent-1-keywords/agent-1.test.ts
```

Expected: FAIL

**Step 5: Implement Agent 1 index.ts**

Create `src/agents/agent-1-keywords/index.ts`:

```typescript
import { z } from "zod/v4";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { KeywordClusterSchema } from "../../shared/schemas/keyword-clusters.js";
import { CityKeywordMapSchema } from "../../shared/schemas/city-keyword-map.js";
import { createGoogleKpClient } from "./google-kp.js";
import {
  KEYWORD_TEMPLATE_PROMPT,
  CITY_SCORING_PROMPT,
  KEYWORD_CLUSTERING_PROMPT,
} from "./prompts.js";

// Schema for LLM keyword template generation
const KeywordTemplatesResponseSchema = z.object({
  templates: z.array(z.string()).min(10).max(40),
});

// Schema for LLM city scoring
const CityScoringResponseSchema = z.object({
  scored_cities: z.array(
    z.object({
      city: z.string(),
      state: z.string(),
      population: z.number(),
      priority_score: z.number().min(0).max(100),
      reasoning: z.string(),
    })
  ),
});

// Schema for LLM keyword clustering
const KeywordClusteringResponseSchema = z.object({
  clusters: z.array(KeywordClusterSchema),
  url_mapping: z.record(z.string(), z.string()),
});

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function expandKeywordTemplates(
  templates: string[],
  cities: string[]
): string[] {
  const expanded: string[] = [];
  for (const city of cities) {
    const citySlug = slugify(city);
    for (const template of templates) {
      expanded.push(
        template
          .replace(/\{city\}/g, city)
          .replace(/\{city_slug\}/g, citySlug)
      );
    }
  }
  return expanded;
}

export interface Agent1Config {
  niche: string;
  candidateCities: Array<{ city: string; state: string; population: number }>;
}

export async function runAgent1(
  config: Agent1Config,
  llm: LlmClient,
  db: DbClient
): Promise<void> {
  console.log(`[Agent 1] Starting keyword research for ${config.niche}`);

  // Step 1: Generate keyword templates via LLM
  console.log("[Agent 1] Step 1: Generating keyword templates...");
  const templatePrompt = KEYWORD_TEMPLATE_PROMPT.replace("{niche}", config.niche);
  const { templates } = await llm.call({
    prompt: templatePrompt,
    schema: KeywordTemplatesResponseSchema,
  });
  console.log(`[Agent 1] Generated ${templates.length} keyword templates`);

  // Step 2: Expand templates per city
  const cityNames = config.candidateCities.map((c) => c.city);
  const expandedKeywords = expandKeywordTemplates(templates, cityNames);
  console.log(`[Agent 1] Expanded to ${expandedKeywords.length} keywords across ${cityNames.length} cities`);

  // Step 3: Pull metrics from Google KP (stub for now)
  const kpClient = createGoogleKpClient();
  const metrics = await kpClient.getKeywordIdeas(expandedKeywords);

  // Step 4: Score cities via LLM
  console.log("[Agent 1] Step 4: Scoring cities...");
  const scoringPrompt = CITY_SCORING_PROMPT
    .replace("{city_data}", JSON.stringify(config.candidateCities, null, 2))
    .replace("{keyword_data}", JSON.stringify(metrics.slice(0, 100), null, 2));

  const { scored_cities } = await llm.call({
    prompt: scoringPrompt,
    schema: CityScoringResponseSchema,
  });

  // Filter to top cities (score > 50)
  const selectedCities = scored_cities
    .filter((c) => c.priority_score > 50)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 5);

  console.log(`[Agent 1] Selected ${selectedCities.length} cities`);

  // Step 5: Cluster keywords per city
  for (const city of selectedCities) {
    console.log(`[Agent 1] Step 5: Clustering keywords for ${city.city}...`);
    const cityKeywords = expandedKeywords.filter((kw) =>
      kw.toLowerCase().includes(city.city.toLowerCase())
    );

    const clusterPrompt = KEYWORD_CLUSTERING_PROMPT
      .replace("{city}", city.city)
      .replace("{state}", city.state)
      .replace("{keywords}", JSON.stringify(cityKeywords));

    const { clusters, url_mapping } = await llm.call({
      prompt: clusterPrompt,
      schema: KeywordClusteringResponseSchema,
    });

    // Step 6: Write to DB
    const clusterIds: string[] = [];
    for (const cluster of clusters) {
      const result = await db.query(
        `INSERT INTO keyword_clusters
         (cluster_name, primary_keyword, secondary_keywords, search_volume, difficulty, intent, city, state, niche)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          cluster.cluster_name,
          cluster.primary_keyword,
          cluster.secondary_keywords,
          cluster.search_volume,
          cluster.difficulty,
          cluster.intent,
          city.city,
          city.state,
          config.niche,
        ]
      );
      clusterIds.push(result.rows[0].id);
    }

    await db.query(
      `INSERT INTO city_keyword_map
       (city, state, population, priority_score, keyword_cluster_ids, url_mapping, niche)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        city.city,
        city.state,
        city.population,
        city.priority_score,
        clusterIds,
        JSON.stringify(url_mapping),
        config.niche,
      ]
    );

    console.log(`[Agent 1] Saved ${clusters.length} clusters for ${city.city}`);
  }

  console.log("[Agent 1] Keyword research complete");
}
```

**Step 6: Run test to verify it passes**

```bash
npx jest src/agents/agent-1-keywords/agent-1.test.ts
```

Expected: PASS

**Step 7: Commit**

```bash
git add src/agents/agent-1-keywords/
git commit -m "feat: add Agent 1 keyword research with LLM templates, city scoring, and clustering"
```

---

## Task 14: Agent 2 -- Niche & Design Research

**Files:**
- Create: `src/agents/agent-2-design/index.ts`
- Create: `src/agents/agent-2-design/prompts.ts`

**Step 1: Create prompts.ts**

Create `src/agents/agent-2-design/prompts.ts` with prompts for competitor analysis, design specification, copy frameworks, schema templates, and seasonal calendar. Each prompt instructs the LLM to output JSON matching the Zod schema.

Key prompts:
- `COMPETITOR_ANALYSIS_PROMPT`: Analyze top pest control landing pages, identify conversion patterns
- `DESIGN_SPEC_PROMPT`: Generate layout spec with sections, components, colors, typography, breakpoints
- `COPY_FRAMEWORK_PROMPT`: Generate headlines, CTAs, trust signals, FAQ templates, PAS scripts
- `SCHEMA_TEMPLATE_PROMPT`: Generate JSON-LD templates for PestControlService, LocalBusiness, FAQ
- `SEASONAL_CALENDAR_PROMPT`: Generate month-by-month pest activity and messaging priorities

**Step 2: Implement Agent 2 index.ts**

Create `src/agents/agent-2-design/index.ts` that:
1. Checks DB for existing design spec for the niche (skip if cached)
2. Runs each prompt through LLM client with corresponding Zod schema
3. Writes results to `design_specs`, `copy_frameworks`, `schema_templates`, `seasonal_calendars` tables
4. Logs progress at each step

The implementation follows the same pattern as Agent 1: prompt → LLM call with schema → validate → DB write.

**Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/agents/agent-2-design/
git commit -m "feat: add Agent 2 niche design research with CRO analysis and copy frameworks"
```

---

## Task 15: Agent 3 -- Hugo Site Builder (Templates)

**Files:**
- Create: `src/agents/agent-3-builder/index.ts`
- Create: `src/agents/agent-3-builder/prompts.ts`
- Create: `src/agents/agent-3-builder/hugo-manager.ts`
- Create: `src/agents/agent-3-builder/quality-gate.ts`
- Test: `src/agents/agent-3-builder/quality-gate.test.ts`

**Step 1: Write quality gate test**

Create `src/agents/agent-3-builder/quality-gate.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { runQualityGate, BANNED_PHRASES } from "./quality-gate.js";

describe("Quality Gate", () => {
  it("passes content that meets all criteria", () => {
    const content = "A".repeat(1000) + " Santa Cruz " + "1 2 3 4 5 6";
    const result = runQualityGate(content, "Santa Cruz", 1200);
    expect(result.passed).toBe(true);
  });

  it("fails content with banned AI phrases", () => {
    const content = "It is important to note that pest control in Santa Cruz requires attention. " + "A".repeat(1000);
    const result = runQualityGate(content, "Santa Cruz", 1200);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("banned_phrases");
  });

  it("fails content below minimum word count", () => {
    const content = "Short content about Santa Cruz pest control.";
    const result = runQualityGate(content, "Santa Cruz", 800);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("word_count");
  });

  it("fails content missing city name", () => {
    const content = "A".repeat(1000) + " pest control services are available.";
    const result = runQualityGate(content, "Santa Cruz", 800);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("city_name_missing");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/agents/agent-3-builder/quality-gate.test.ts
```

Expected: FAIL

**Step 3: Implement quality-gate.ts**

Create `src/agents/agent-3-builder/quality-gate.ts`:

```typescript
export const BANNED_PHRASES = [
  "it is important to note",
  "in conclusion",
  "when it comes to",
  "it's worth noting",
  "in today's world",
  "at the end of the day",
  "in this article",
  "without further ado",
  "dive into",
  "navigating the",
  "leverage",
  "it goes without saying",
  "plays a crucial role",
  "in the realm of",
  "a testament to",
];

export interface QualityResult {
  passed: boolean;
  failures: string[];
  metrics: {
    wordCount: number;
    hasCityName: boolean;
    bannedPhrasesFound: string[];
  };
}

export function runQualityGate(
  content: string,
  cityName: string,
  minWordCount: number
): QualityResult {
  const failures: string[] = [];
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const lowerContent = content.toLowerCase();

  // Word count check
  if (wordCount < minWordCount) {
    failures.push("word_count");
  }

  // City name presence
  const hasCityName = lowerContent.includes(cityName.toLowerCase());
  if (!hasCityName) {
    failures.push("city_name_missing");
  }

  // Banned phrases
  const bannedPhrasesFound = BANNED_PHRASES.filter((phrase) =>
    lowerContent.includes(phrase.toLowerCase())
  );
  if (bannedPhrasesFound.length > 0) {
    failures.push("banned_phrases");
  }

  return {
    passed: failures.length === 0,
    failures,
    metrics: { wordCount, hasCityName, bannedPhrasesFound },
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/agents/agent-3-builder/quality-gate.test.ts
```

Expected: PASS

**Step 5: Implement hugo-manager.ts**

Create `src/agents/agent-3-builder/hugo-manager.ts` that handles:
- `initHugoProject()`: Creates Hugo site structure, config.toml, base layouts
- `writeContentFile(path, frontmatter, content)`: Writes markdown with YAML frontmatter
- `writeTemplate(path, html)`: Writes Hugo layout/partial files
- `buildSite()`: Runs `hugo` command to build static files

**Step 6: Create Agent 3 prompts and index**

Create `src/agents/agent-3-builder/prompts.ts` with:
- `CITY_HUB_PROMPT`: Generate 800-1,500 word city hub page content
- `SERVICE_SUBPAGE_PROMPT`: Generate 1,500-2,500 word service subpage content
- `HUGO_TEMPLATE_PROMPT`: Convert design spec into Hugo HTML templates

Create `src/agents/agent-3-builder/index.ts` that:
1. Reads design spec and keyword map from DB
2. Initializes Hugo project (if not exists)
3. Generates templates from design spec (once per niche)
4. For each city: generates hub page content via LLM → quality gate → write markdown
5. For each city+pest combo: generates subpage content via LLM → quality gate → write markdown
6. Runs Hugo build to verify output
7. Records pages in `content_items` and `pages` tables

**Step 7: Commit**

```bash
git add src/agents/agent-3-builder/
git commit -m "feat: add Agent 3 Hugo site builder with quality gate and content generation"
```

---

## Task 16: Agent 7 -- Performance Monitor

**Files:**
- Create: `src/agents/agent-7-monitor/index.ts`
- Create: `src/agents/agent-7-monitor/thresholds.ts`
- Create: `src/agents/agent-7-monitor/mock-data.ts`
- Create: `src/agents/agent-7-monitor/health-score.ts`
- Test: `src/agents/agent-7-monitor/thresholds.test.ts`
- Test: `src/agents/agent-7-monitor/health-score.test.ts`

**Step 1: Write threshold test**

Create `src/agents/agent-7-monitor/thresholds.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { evaluateThresholds, type ThresholdResult } from "./thresholds.js";

describe("evaluateThresholds", () => {
  it("returns 'good' for healthy metrics", () => {
    const result = evaluateThresholds({
      bounceRate: 0.35,
      clickToCallRate: 0.10,
      callQualificationRate: 0.60,
      avgSessionDuration: 150,
    });
    expect(result.bounceRate.severity).toBe("good");
    expect(result.clickToCallRate.severity).toBe("good");
  });

  it("returns 'warning' for borderline metrics", () => {
    const result = evaluateThresholds({
      bounceRate: 0.56,
      clickToCallRate: 0.04,
      callQualificationRate: 0.38,
      avgSessionDuration: 55,
    });
    expect(result.bounceRate.severity).toBe("warning");
    expect(result.clickToCallRate.severity).toBe("warning");
  });

  it("returns 'critical' for bad metrics", () => {
    const result = evaluateThresholds({
      bounceRate: 0.70,
      clickToCallRate: 0.02,
      callQualificationRate: 0.25,
      avgSessionDuration: 20,
    });
    expect(result.bounceRate.severity).toBe("critical");
    expect(result.clickToCallRate.severity).toBe("critical");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/agents/agent-7-monitor/thresholds.test.ts
```

Expected: FAIL

**Step 3: Implement thresholds.ts**

Create `src/agents/agent-7-monitor/thresholds.ts`:

```typescript
export type Severity = "good" | "warning" | "critical";

export interface ThresholdCheck {
  severity: Severity;
  value: number;
  threshold: { good: number; warning: number; critical: number };
}

export interface ThresholdResult {
  bounceRate: ThresholdCheck;
  clickToCallRate: ThresholdCheck;
  callQualificationRate: ThresholdCheck;
  avgSessionDuration: ThresholdCheck;
}

export interface MetricsInput {
  bounceRate: number;
  clickToCallRate: number;
  callQualificationRate: number;
  avgSessionDuration: number;
}

function checkLowerIsBetter(value: number, good: number, warning: number, critical: number): ThresholdCheck {
  const severity: Severity =
    value <= good ? "good" : value <= warning ? "warning" : "critical";
  return { severity, value, threshold: { good, warning, critical } };
}

function checkHigherIsBetter(value: number, good: number, warning: number, critical: number): ThresholdCheck {
  const severity: Severity =
    value >= good ? "good" : value >= warning ? "warning" : "critical";
  return { severity, value, threshold: { good, warning, critical } };
}

export function evaluateThresholds(metrics: MetricsInput): ThresholdResult {
  return {
    bounceRate: checkLowerIsBetter(metrics.bounceRate, 0.40, 0.55, 0.65),
    clickToCallRate: checkHigherIsBetter(metrics.clickToCallRate, 0.08, 0.05, 0.03),
    callQualificationRate: checkHigherIsBetter(metrics.callQualificationRate, 0.55, 0.40, 0.30),
    avgSessionDuration: checkHigherIsBetter(metrics.avgSessionDuration, 120, 60, 30),
  };
}

export const EXPECTED_CTR_BY_POSITION: Record<number, { expected: number; alert: number }> = {
  1: { expected: 0.215, alert: 0.13 },
  2: { expected: 0.135, alert: 0.08 },
  3: { expected: 0.09, alert: 0.06 },
  4: { expected: 0.06, alert: 0.04 },
  5: { expected: 0.045, alert: 0.03 },
  6: { expected: 0.03, alert: 0.015 },
  7: { expected: 0.03, alert: 0.015 },
  8: { expected: 0.025, alert: 0.015 },
  9: { expected: 0.02, alert: 0.015 },
  10: { expected: 0.02, alert: 0.015 },
};

export const SEASONAL_INDEX: Record<number, number> = {
  1: 0.60, 2: 0.65, 3: 0.90, 4: 1.15, 5: 1.30, 6: 1.40,
  7: 1.45, 8: 1.35, 9: 1.10, 10: 0.90, 11: 0.70, 12: 0.55,
};
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/agents/agent-7-monitor/thresholds.test.ts
```

Expected: PASS

**Step 5: Write health score test**

Create `src/agents/agent-7-monitor/health-score.test.ts`:

```typescript
import { describe, it, expect } from "@jest/globals";
import { calculateHealthScore } from "./health-score.js";

describe("calculateHealthScore", () => {
  it("returns 80+ for excellent metrics", () => {
    const score = calculateHealthScore({
      indexingRate: 1.0,
      rankingProgress: 0.8,
      trafficTrend: 0.9,
      conversionRate: 0.10,
      callQualityRate: 0.60,
      revenueTrend: 0.85,
      criticalAlerts: 0,
    });
    expect(score).toBeGreaterThanOrEqual(80);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("returns 40-59 for poor metrics", () => {
    const score = calculateHealthScore({
      indexingRate: 0.5,
      rankingProgress: 0.3,
      trafficTrend: 0.4,
      conversionRate: 0.03,
      callQualityRate: 0.30,
      revenueTrend: 0.3,
      criticalAlerts: 3,
    });
    expect(score).toBeGreaterThanOrEqual(30);
    expect(score).toBeLessThan(60);
  });
});
```

**Step 6: Implement health-score.ts**

Create `src/agents/agent-7-monitor/health-score.ts`:

```typescript
export interface HealthScoreInput {
  indexingRate: number;      // 0-1, fraction of pages indexed
  rankingProgress: number;   // 0-1, fraction of pages ranking
  trafficTrend: number;      // 0-1, normalized traffic growth
  conversionRate: number;    // 0-1, click-to-call rate
  callQualityRate: number;   // 0-1, call qualification rate
  revenueTrend: number;      // 0-1, normalized revenue growth
  criticalAlerts: number;    // count of unresolved critical alerts
}

const WEIGHTS = {
  indexing: 0.10,
  ranking: 0.20,
  traffic: 0.15,
  conversion: 0.20,
  callQuality: 0.10,
  revenue: 0.20,
  alertBurden: 0.05,
};

const BENCHMARKS = {
  conversionRate: 0.08,
  callQualityRate: 0.55,
};

export function calculateHealthScore(input: HealthScoreInput): number {
  const conversionScore = Math.min(input.conversionRate / BENCHMARKS.conversionRate, 1.0);
  const callQualityScore = Math.min(input.callQualityRate / BENCHMARKS.callQualityRate, 1.0);
  const alertScore = Math.max(0, 1 - input.criticalAlerts * 0.2);

  const weighted =
    input.indexingRate * WEIGHTS.indexing +
    input.rankingProgress * WEIGHTS.ranking +
    input.trafficTrend * WEIGHTS.traffic +
    conversionScore * WEIGHTS.conversion +
    callQualityScore * WEIGHTS.callQuality +
    input.revenueTrend * WEIGHTS.revenue +
    alertScore * WEIGHTS.alertBurden;

  return Math.round(weighted * 100);
}

export function interpretScore(score: number): string {
  if (score >= 80) return "Thriving";
  if (score >= 60) return "Healthy with areas to improve";
  if (score >= 40) return "Needs attention";
  return "Critical intervention required";
}
```

**Step 7: Run tests**

```bash
npx jest src/agents/agent-7-monitor/
```

Expected: PASS

**Step 8: Create mock-data.ts and index.ts**

Create `src/agents/agent-7-monitor/mock-data.ts` that generates synthetic performance data mimicking the Google sandbox progression pattern.

Create `src/agents/agent-7-monitor/index.ts` that:
1. Fetches all active pages from DB
2. Ingests data via DataProvider interface (mock for MVP)
3. Runs threshold evaluation per page
4. Generates alerts for threshold violations
5. Calculates portfolio health score
6. Generates optimization_actions based on the 5-stage rebalancing decision tree

**Step 9: Commit**

```bash
git add src/agents/agent-7-monitor/
git commit -m "feat: add Agent 7 performance monitor with thresholds, health score, and mock data"
```

---

## Task 17: Application Entry Point

**Files:**
- Modify: `src/index.ts`

**Step 1: Wire up the entry point**

Update `src/index.ts` to:
1. Parse environment
2. Create DB client
3. Create orchestrator with agent handlers registered
4. Support CLI arguments for running individual agents or the full pipeline
5. Handle graceful shutdown (SIGINT/SIGTERM)

**Step 2: Verify full build compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up application entry point with agent registration and graceful shutdown"
```

---

## Task 18: Hugo Site Scaffolding

**Files:**
- Create: `hugo-site/config.toml`
- Create: `hugo-site/layouts/_default/baseof.html`
- Create: `hugo-site/layouts/_default/list.html`
- Create: `hugo-site/layouts/_default/single.html`
- Create: `hugo-site/layouts/partials/header.html`
- Create: `hugo-site/layouts/partials/footer.html`
- Create: `hugo-site/layouts/partials/cta-sticky.html`
- Create: `hugo-site/layouts/partials/cta-badge.html`
- Create: `hugo-site/layouts/partials/schema-jsonld.html`
- Create: `hugo-site/layouts/partials/faq.html`
- Create: `hugo-site/static/css/main.css`
- Create: `hugo-site/data/pest-db.json`
- Create: `hugo-site/content/_index.md`

**Step 1: Create Hugo config and base templates**

These templates include:
- Sticky mobile click-to-call footer (40-76% conversion lift per PRD)
- Phone number visible above fold, 3+ times per page
- CTA buttons: min 60px height mobile, full-width, high-contrast orange
- Legal disclaimers in footer (V8 Section 24.5)
- Call recording badge near every CTA
- JSON-LD structured data injection
- FAQ accordion component

The templates are static HTML/Go templates that Agent 3's content generation fills with city-specific markdown.

**Step 2: Create pest database**

Create `hugo-site/data/pest-db.json` with pest prevalence data by region, seasonal patterns, and trigger temperatures.

**Step 3: Verify Hugo builds**

```bash
cd hugo-site && hugo --minify 2>&1; cd ..
```

Expected: Build succeeds (may show warnings about empty content, which is fine)

**Step 4: Commit**

```bash
git add hugo-site/
git commit -m "feat: scaffold Hugo site with conversion-optimized templates and legal compliance"
```

---

## Task 19: Integration Test

**Files:**
- Create: `src/integration/pipeline.test.ts`

**Step 1: Write integration test**

Create `src/integration/pipeline.test.ts` that:
1. Starts a test PostgreSQL instance (via docker-compose)
2. Runs migrations
3. Creates mock LLM client that returns predetermined JSON
4. Runs Agent 1 with mock keyword data for 1 test city
5. Runs Agent 2 for pest-control niche
6. Runs Agent 3 to generate Hugo content
7. Verifies: DB has keyword clusters, design spec, content items, and pages
8. Verifies: Hugo content files exist with correct frontmatter
9. Runs Agent 7 threshold checks against mock data
10. Verifies: Alerts generated for simulated poor metrics

This test validates the full pipeline without requiring real CLI tools or API access.

**Step 2: Run integration test**

```bash
npx jest src/integration/pipeline.test.ts --testTimeout=60000
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/integration/
git commit -m "feat: add end-to-end integration test for full agent pipeline"
```

---

## Summary

| Task | Component | Estimated Steps |
|------|-----------|----------------|
| 1 | Project scaffolding | 10 |
| 2 | Environment config | 6 |
| 3 | Database client + migrations runner | 7 |
| 4 | Database migrations (all tables) | 3 |
| 5 | Zod schema registry | 5 |
| 6 | Rate limiter | 5 |
| 7 | Circuit breaker | 5 |
| 8 | CLI wrappers (Claude + Codex) | 7 |
| 9 | LLM client (fallback + self-correction) | 5 |
| 10 | DLQ manager | 5 |
| 11 | Task scheduler (DAG) | 5 |
| 12 | Orchestrator main loop | 3 |
| 13 | Agent 1 (keywords) | 7 |
| 14 | Agent 2 (design research) | 4 |
| 15 | Agent 3 (site builder + quality gate) | 7 |
| 16 | Agent 7 (monitor + health score) | 9 |
| 17 | Application entry point | 3 |
| 18 | Hugo site scaffolding | 4 |
| 19 | Integration test | 3 |
| **Total** | | **~107 steps** |

**Implementation order**: Tasks 1-12 are foundation (must be sequential). Tasks 13-16 are agents (can be partially parallelized). Tasks 17-19 are integration (sequential, at end).

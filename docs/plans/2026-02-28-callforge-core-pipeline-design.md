# CallForge Core Pipeline Design

**Date**: 2026-02-28
**Scope**: Orchestrator + Agent 1 (Keywords) + Agent 2 (Design Research) + Agent 3 (Site Builder) + Agent 7 (Performance Monitor)
**Target**: 3-5 cities MVP for extermanation.com (pest control)

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Monorepo, single Node.js process | Shared rate limiters, simple deployment, sufficient for 4 agents |
| Language | TypeScript | Aligns with PRD v7/v8 code examples, Zod v4 native |
| Database | Local PostgreSQL (Docker) | Supabase migration later; local dev first |
| Site generator | Hugo | Builds 1000+ pages in <1s, pure markdown workflow |
| Keyword data | Google Keyword Planner | Only available source; LLM fallback for volume estimates |
| Agent 7 data | Mock data | Real GSC/GA4/MarketCall integration deferred |
| Hardening | Foundation-first | Zod, Bottleneck, DLQ, circuit breakers from day one |
| Environment | VPS | Claude Code CLI + Codex CLI available |

---

## Project Structure

```
parallel-callforge/
├── src/
│   ├── orchestrator/
│   │   ├── index.ts              # Main entry point, agent scheduling
│   │   ├── task-scheduler.ts     # DAG-based task dependency resolution
│   │   ├── dlq-manager.ts        # Dead-letter queue operations
│   │   └── types.ts              # Orchestrator-specific types
│   ├── agents/
│   │   ├── agent-1-keywords/     # Keyword Research + City Strategy
│   │   │   ├── index.ts
│   │   │   ├── prompts.ts        # LLM prompt templates
│   │   │   └── google-kp.ts      # Google Keyword Planner integration
│   │   ├── agent-2-design/       # Niche & Design Research
│   │   │   ├── index.ts
│   │   │   └── prompts.ts
│   │   ├── agent-3-builder/      # Site Builder (Hugo)
│   │   │   ├── index.ts
│   │   │   ├── prompts.ts
│   │   │   ├── hugo-manager.ts   # Hugo project operations
│   │   │   └── templates/        # Hugo template generators
│   │   └── agent-7-monitor/      # Performance Monitor
│   │       ├── index.ts
│   │       ├── prompts.ts
│   │       ├── thresholds.ts     # Industry-calibrated alert thresholds
│   │       └── mock-data.ts      # Mock GSC/GA4/MarketCall data
│   ├── shared/
│   │   ├── schemas/              # Zod v4 schemas (one per DB table)
│   │   │   ├── keyword-clusters.ts
│   │   │   ├── content-items.ts
│   │   │   ├── design-specs.ts
│   │   │   ├── pages.ts
│   │   │   ├── performance-snapshots.ts
│   │   │   ├── agent-tasks.ts
│   │   │   └── dead-letter-queue.ts
│   │   ├── cli/
│   │   │   ├── claude-cli.ts     # Claude Code CLI wrapper
│   │   │   ├── codex-cli.ts      # Codex CLI wrapper
│   │   │   ├── llm-client.ts     # Unified interface with fallback cascade
│   │   │   └── rate-limiter.ts   # Bottleneck instances per provider
│   │   ├── db/
│   │   │   ├── client.ts         # PostgreSQL connection (pg)
│   │   │   ├── migrations/       # SQL migration files
│   │   │   └── queries/          # Typed query functions
│   │   └── circuit-breaker.ts    # Opossum wrapper per provider
│   ├── config/
│   │   ├── env.ts                # Environment variable validation
│   │   └── rate-limits.ts        # Provider-specific rate limit configs
│   └── index.ts                  # Application entry point
├── hugo-site/                    # Hugo project (managed by Agent 3)
│   ├── config.toml
│   ├── content/
│   ├── layouts/
│   ├── static/
│   └── themes/
├── docker-compose.yml            # PostgreSQL for local dev
├── Dockerfile
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript 5.x
- **Database**: PostgreSQL 16 via `pg` driver
- **Validation**: Zod v4 (schema registry + JSON Schema generation for CLI)
- **Rate limiting**: Bottleneck (per-provider token buckets)
- **Circuit breaker**: Opossum (per-provider failure detection)
- **Static site**: Hugo
- **Scheduling**: node-cron (same process)
- **Testing**: Jest

---

## Orchestrator Design

### Task Scheduling

DAG-based execution. Tasks have type, agent assignment, payload, dependencies, and status.

**Pipeline for a new city deployment:**
```
Agent 1 (Keywords)  ──→  Agent 2 (Design)  ──→  Agent 3 (Build)  ──→  Agent 7 (Monitor)
     │                        │                       │
     └── keyword_clusters     └── design_spec         └── deployed pages
         city_keyword_map         copy_frameworks          performance tracking
```

- Agents 1 and 2 can run in parallel (Agent 2 runs once per niche, not per city)
- Agent 3 depends on both Agent 1 and Agent 2 completing
- Agent 7 runs on a schedule after pages are deployed

**Task states**: `pending` → `running` → `completed` | `failed` → `dlq`

The orchestrator polls the `agent_tasks` table, resolves dependencies, and dispatches work via a simple loop (not event-driven -- keeps it debuggable).

### CLI Wrapper (llm-client.ts)

Follows the PRD V8 `callLLMWithValidation` pattern:

1. Accept a Zod schema + prompt
2. Generate JSON Schema via `z.toJSONSchema()`
3. Try Claude CLI first (with `--json-schema` flag for constrained decoding)
4. On rate limit → fall back to Codex CLI
5. Parse response, validate with Zod
6. On validation failure → self-correction retry (up to 3 attempts, feeding Zod errors back)
7. On permanent failure → route to DLQ

**Provider rate limits (Bottleneck configs):**
- Claude CLI: maxConcurrent=1, minTime=15000ms, reservoir=40/day
- Codex CLI: maxConcurrent=1, minTime=15000ms, reservoir=40/day

Each provider wrapped in Opossum circuit breaker: opens after 3 consecutive failures, half-opens after 60s.

**Rate limit detection**: Parse stderr for patterns (`/rate.?limit/i`, `/429/`, `/too many requests/i`). Extract retry-after timing when available.

### Dead-Letter Queue

Matches V8 Section 24.3 spec:
- `dead_letter_queue` table with UUID primary key
- Error classification: transient, permanent, unknown
- Fingerprinting: SHA-256 of (task_type + agent_name + payload), truncated to 16 chars
- Deduplication: check fingerprint before insert, update existing if found
- Orchestrator checks DLQ before scheduling any task

### Content Velocity Controls

Bottleneck instance enforcing max 3 cities per week (V8 Section 24.4):
- reservoir=3, reservoirRefreshInterval=7 days
- Applied at orchestrator level before Agent 3 execution

---

## Agent 1: Keyword Research + City Strategy

### Purpose
Identify target cities and keyword clusters. Produce data that Agent 3 consumes.

### Data Source
Google Keyword Planner via Google Ads API (`KeywordPlanIdeaService`). Requires developer token + OAuth2 credentials. Free with active Google Ads account.

### Workflow
1. **Generate keyword templates**: LLM produces ~20-30 patterns per niche (e.g., "[city] pest control", "termite treatment [city]")
2. **Expand per city**: For each candidate city (10-15 initial list), expand templates into concrete queries
3. **Pull metrics**: Batch to Google Keyword Planner (max 2,500 keywords/request) for volume + competition
4. **Score cities**: LLM analyzes KP data + US Census population data, applies PRD criteria (75K-250K pop, 50-500 volume/mo, weak competition)
5. **Cluster keywords**: LLM groups by search intent, maps to URL structure (`/city/`, `/city/service/`)
6. **Write to DB**: `keyword_clusters` and `city_keyword_map` rows

### LLM Calls
- Step 1: Single call with Zod-enforced keyword template schema
- Step 4: Single call with city scoring schema
- Step 5: Single call with clustering schema

### Fallback
If Google KP unavailable, fall back to LLM-estimated volumes (less accurate but functional for MVP).

### Output Schemas
```
keyword_clusters: {
  cluster_name, primary_keyword, secondary_keywords[],
  search_volume, difficulty, intent
}
city_keyword_map: {
  city, state, population, priority_score,
  keyword_clusters[], url_mapping{}
}
```

---

## Agent 2: Niche & Design Research

### Purpose
Run once per vertical to produce design spec and copy frameworks for Agent 3.

### Workflow
1. **Competitor analysis**: LLM analyzes top pest control landing pages per PRD criteria
2. **Page archetype selection**: Select from PRD's five archetypes for MVP
3. **Design specification**: Generate layout spec (sections, components, responsive breakpoints, colors, typography)
4. **Copy frameworks**: Headlines, CTA variants, trust signals, FAQ templates, PAS scripts
5. **Schema templates**: JSON-LD for PestControlService, LocalBusiness, FAQ
6. **Seasonal calendar**: Month-by-month messaging priorities

### LLM Calls
Each step is a separate Claude CLI call with its own Zod schema. Most LLM-intensive agent.

### Caching
Runs once per niche. Output cached in DB, reused across all cities for that niche.

### Output Schemas
```
design_specs: {
  niche, archetype, layout{}, components[],
  colors{}, typography{}, responsive_breakpoints{}
}
copy_frameworks: {
  niche, headlines[], ctas[], trust_signals[],
  faq_templates[], pas_scripts[]
}
schema_templates: { niche, jsonld_templates{} }
seasonal_calendar: {
  niche, months[]{ month, pests[], messaging_priority, content_themes[] }
}
```

---

## Agent 3: Site Builder (Hugo)

### Purpose
Core production agent. Generates Hugo content and templates, deploys to Netlify.

### Workflow
1. **Initialize Hugo project** (once): Create site structure, base layout, `config.toml`
2. **Generate templates** (once per niche): Convert Agent 2's design spec into Hugo layouts and partials
3. **Generate city hub pages**: Per city, LLM produces 800-1,500 word markdown with 5+ unique local data points
4. **Generate service subpages**: Per city+pest, LLM produces 1,500-2,500 word content with PAS structure
5. **Local data injection**: WeatherAPI.com, US Census API, static pest DB → embed unique data points (V8: 60% unique content minimum)
6. **Quality gate**: Readability (Flesch 55-75), word count, city name presence, data points, no banned phrases
7. **Git commit + deploy**: Batch 2-3 pages per commit, push to GitHub, Netlify auto-builds

### Hugo Site Structure
```
hugo-site/
  config.toml
  content/
    _index.md                    # Homepage
    santa-cruz/
      _index.md                  # City hub (800-1,500 words)
      termites.md                # Service subpage (1,500-2,500 words)
      rodents.md
    atlanta/
      _index.md
      termites.md
  layouts/
    _default/baseof.html
    _default/list.html           # City hub template
    _default/single.html         # Service subpage template
    partials/
      header.html
      footer.html                # Legal disclaimers (V8 24.5)
      cta-sticky.html            # Sticky mobile click-to-call
      cta-badge.html             # Call recording disclosure badge
      schema-jsonld.html         # Structured data
      faq.html
  static/css/ js/ images/
  data/pest-db.json
```

### Legal Compliance (V8 Section 24.5)
Built into templates from day one:
- Footer disclaimer: referral service disclosure, call recording notice
- Call recording badge adjacent to every CTA
- Privacy Policy and Terms of Service pages
- `tel:` links with UTM parameters

### Non-Negotiable Design Elements (PRD)
- Sticky mobile click-to-call footer
- Phone number visible above fold, 3+ times per page
- Page load <2 seconds
- CTA button: min 60px mobile, full-width, high-contrast
- No forms -- phone-only conversion
- No navigation away from conversion path

---

## Agent 7: Performance Monitor + Rebalancer

### Purpose
Feedback loop. Tracks rankings, traffic, calls, revenue. Triggers optimization when thresholds crossed.

### Data Strategy
Mock data for MVP. Each data source behind an interface; mock implementations swap for real ones later.

```typescript
interface DataProvider {
  fetchRankings(siteUrl: string, dateRange: DateRange): Promise<RankingData[]>;
  fetchTraffic(propertyId: string, dateRange: DateRange): Promise<TrafficData[]>;
  fetchCalls(dateRange: DateRange): Promise<CallRecord[]>;
}
```

### Mock Data Generation
Realistic synthetic data for 3-5 cities:
- Rankings: Start position 50+, gradually improve (mimics Google sandbox)
- Traffic: Low initial, correlates with ranking improvements
- Calls: traffic * conversion_rate * qualification_rate
- Revenue: calls * avg_payout ($35-50)

### Scheduled Jobs (node-cron)
- 06:00 UTC: Fetch ranking data
- 08:00 UTC: Fetch traffic data
- 09:00 UTC: Aggregate call records
- 09:30 UTC: Run threshold checks, generate alerts
- Sundays 11:00 UTC: Weekly analysis
- 1st of month: Monthly report
- Every 6 hours: Update portfolio health score

### Threshold Evaluation (PRD calibrated)
| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Bounce rate | <40% | 55% | >65% |
| Click-to-call conversion | >8% | 5% | <3% |
| Call qualification rate | >55% | 40% | <30% |
| Avg session duration | >120s | 60s | <30s |

### Rebalancing Decision Tree (5 stages)
1. **Indexing** (daily): Not indexed after 7/14/30 days → escalating actions
2. **Ranking** (weekly): Position checks → content enhancement / link building triggers
3. **CTR** (weekly): Below expected by position → title/meta rewrites
4. **Conversion** (weekly): Low click-to-call → CTA audit
5. **Revenue** (monthly): ROI evaluation → maintain/optimize/sunset

### Portfolio Health Score (0-100)
Weighted: indexing 10%, ranking 20%, traffic 15%, conversion 20%, call quality 10%, revenue 20%, alert burden 5%.

### LLM Usage
Agent 7 does NOT use LLM for routine monitoring (pure TypeScript logic). LLM reserved for:
- Natural-language report summaries (occasional)
- Differentiation logic: backlinks vs content vs design changes (occasional)

---

## Database Schema

### Core Tables
- `agent_tasks`: id, task_type, agent_name, payload (JSONB), status, dependencies (UUID[]), created_at, started_at, completed_at, error_message
- `dead_letter_queue`: id, original_task_id, task_type, agent_name, payload (JSONB), error_message, error_stack, error_class, retry_count, max_retries, fingerprint, first/last_failed_at, resolved_at, resolution, notes
- `keyword_clusters`: id, cluster_name, primary_keyword, secondary_keywords (TEXT[]), search_volume, difficulty, intent, city, state, niche
- `city_keyword_map`: id, city, state, population, priority_score, keyword_cluster_ids (UUID[]), url_mapping (JSONB), deployment_status
- `design_specs`: id, niche, archetype, layout (JSONB), components (JSONB), colors (JSONB), typography (JSONB), responsive_breakpoints (JSONB)
- `copy_frameworks`: id, niche, headlines (JSONB), ctas (JSONB), trust_signals (JSONB), faq_templates (JSONB), pas_scripts (JSONB)
- `content_items`: id, title, slug (unique), status, target_keyword, search_volume, keyword_difficulty, pest_type, city, content_type, scheduled_date, published_date, author_persona, quality_score (JSONB), word_count
- `pages`: id, url, slug, city, state, niche, target_keyword, status, published_at
- `performance_snapshots`: id, page_id, snapshot_date, sessions, users, pageviews, organic_sessions, bounce_rate, avg_session_duration, click_to_call_count, calls_total, calls_qualified, revenue
- `ranking_snapshots`: id, page_id, snapshot_date, query, device, clicks, impressions, ctr, position
- `call_records`: id, external_call_id, page_id, call_timestamp, duration_seconds, is_qualified, payout, status, caller_city, caller_state
- `alerts`: id, page_id, alert_type, severity, message, metric_name, threshold_value, is_resolved, created_at
- `optimization_actions`: id, page_id, alert_id, action_type, target_agent, trigger_reason, status, created_at

### Indexes
- `agent_tasks`: status, agent_name
- `dead_letter_queue`: partial on resolved_at IS NULL, agent_name + last_failed_at DESC, fingerprint
- `keyword_clusters`: niche, city
- `content_items`: status + published_date, slug (unique)
- `performance_snapshots`: page_id + snapshot_date (unique)
- `ranking_snapshots`: page_id + snapshot_date + query + device (unique)
- `alerts`: is_resolved, page_id

---

## Error Handling

Three layers (V8 spec):
1. **CLI-level**: Zod schema via `--json-schema` for constrained decoding
2. **Application-level**: Zod `.parse()` validates every CLI response
3. **Self-correction**: Feed Zod errors back to LLM (3 retries)
4. **Permanent failure**: Route to DLQ with classification

Rate limit detection: parse stderr for known patterns. Circuit breaker opens after 3 consecutive failures, half-opens after 60s.

---

## Testing Strategy

- **Unit tests** (Jest): Scoring algorithms, threshold checks, schema validation, URL mapping
- **Integration tests**: CLI wrappers against mock CLI (shell script returning predictable JSON)
- **Database tests**: Test PostgreSQL instance (Docker) with migrations
- **Pipeline test**: Full Agent 1 → 2 → 3 flow against mock keyword data, verify Hugo output

---

## Development Workflow

```bash
docker-compose up          # Start PostgreSQL
npm run migrate            # Apply database migrations
npm run dev                # Start orchestrator (dev mode, file watching)
npm run agent:1 -- --city "santa cruz"   # Run individual agent
npm run pipeline           # Run full Agent 1 → 2 → 3 flow
npm test                   # Run all tests
```

---

## Environment Variables

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

---

## Implementation Order

1. **Shared infrastructure**: Database setup, migrations, Zod schemas, CLI wrappers, rate limiter, circuit breaker, DLQ manager
2. **Orchestrator**: Task scheduler, dependency resolution, main loop
3. **Agent 1**: Keyword templates, Google KP integration, city scoring, clustering
4. **Agent 2**: Design spec generation, copy frameworks, schema templates
5. **Agent 3**: Hugo project init, template generation, content generation, quality gate, deployment
6. **Agent 7**: Data provider interface, mock data, threshold checks, alerts, health score, scheduling
7. **Integration**: End-to-end pipeline test with 1 city, then scale to 3-5

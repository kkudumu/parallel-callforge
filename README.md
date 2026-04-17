# CallForge — Parallel CallForge

**AI-powered multi-agent system for programmatic pay-per-call lead generation.**

CallForge spins up local-service websites (starting with pest control) at the city level, optimizes them for organic search, and converts visitors directly into phone calls that are monetized via pay-per-call affiliate networks. The whole pipeline — market selection, keyword research, design research, page generation, deployment, and performance monitoring — is run by cooperating agents backed by PostgreSQL, the Claude / Codex / Gemini CLIs, and Hugo.

- **First deployment target:** `extermanation.com` (pest control)
- **Spec of record:** `CallForge PRD v9.md` + the V7 / V8 PRDs (build-in-public)
- **Mode:** organic-first, phone-only conversion, no forms, TCPA-compliant templates
- **Status:** MVP producing live cities (Shawnee, Deland, Lenexa, Athens, Port Orange) with research, hybrid content generation, self-healing, and a watchdog loop all wired up

---

## Table of Contents

1. [What CallForge does](#what-callforge-does)
2. [Current architecture (mermaid)](#current-architecture)
3. [Future architecture (mermaid)](#future-architecture)
4. [Agents in detail](#agents-in-detail)
5. [Data model](#data-model)
6. [Orchestration, self-healing, and observability](#orchestration-self-healing-and-observability)
7. [Vertical and offer model](#vertical-and-offer-model)
8. [Quality and compliance guardrails](#quality-and-compliance-guardrails)
9. [Roadmap: what is still deferred](#roadmap)
10. [Local setup](#local-setup)
11. [Commands](#commands)
12. [Repository map](#repository-map)

---

## What CallForge does

The business model is simple:

1. Pick cities where local-service buyers (pest control operators, HVAC, roofing, etc.) are willing to pay for inbound phone calls.
2. Build highly-localized city + service pages that rank organically for `"{service} {city}"` queries.
3. Route every call to a pay-per-call tracking number tied to an affiliate offer.
4. Monitor rankings, traffic, and call quality. Close the loop: when a page underperforms, re-trigger the agents that can fix it (content refresh, CTA optimization, keyword refinement).

Everything is codified as a multi-agent pipeline so the portfolio can scale without manual research. A single **offer profile** (e.g. `pestcontrol-1`) describes the monetization constraints (ZIP coverage, disallowed pests, required disclaimer, banned phrases, target call length). A single **vertical profile** (e.g. `pest-control`) describes the reusable playbook for the niche. Every downstream agent reads the merged runtime constraints.

---

## Current architecture

This is what is actually implemented and wired up on `master` today.

```mermaid
flowchart TB
    %% ===== Inputs =====
    subgraph INPUT[Operator Inputs]
        OFFER["Offer text & ZIP spreadsheet<br/>(pestcontrol-1)"]
        VERT["Vertical definition<br/>(pest-control / hvac / roofing)"]
    end

    %% ===== Entry Points =====
    subgraph ENTRY[Entry Points]
        CLI["CLI: src/index.ts<br/>offer-profile | vertical-profile<br/>agent-0.5 | agent-1 | agent-2<br/>agent-3 | agent-7 | pipeline | orchestrate"]
        DASH["Dashboard API<br/>src/dashboard-server.ts<br/>+ React UI (Vite + Tailwind)"]
        SUP["Supervisor<br/>src/supervisor.ts<br/>(spawn + crash-diagnose)"]
    end

    %% ===== Profiles =====
    subgraph PROFILE[Profile Resolution]
        OP["offer_profiles table<br/>+ offer-profiles.ts"]
        VP["vertical_profiles table<br/>+ vertical-profiles.ts"]
        STRAT["Vertical strategies<br/>src/verticals/*<br/>pest-control / default"]
        MERGE["Merge constraints:<br/>allowed/disallowed services,<br/>banned phrases, disclaimer,<br/>geo sources"]
    end

    %% ===== LLM Infra =====
    subgraph LLM[LLM Infrastructure]
        CLAUDE["Claude CLI wrapper"]
        CODEX["Codex CLI wrapper"]
        GEMINI["Gemini CLI wrapper"]
        ROUTER["llm-client.ts<br/>fallback + round-robin<br/>+ Zod validation retry"]
        RATE["Bottleneck rate limiters"]
        CB["Opossum circuit breakers"]
    end

    %% ===== Pipeline =====
    subgraph PIPELINE[Pipeline Execution]
        direction TB

        A05["Agent 0.5 — Geo Scanner<br/>ZIP → city coverage clusters<br/>deterministic scoring<br/>(coverage, population, density,<br/>spread, deployment fit)"]

        A1["Agent 1 — Keywords<br/>Phase 1: 4 research subagents<br/>(Claude Agent SDK, WebSearch)<br/>Phase 2: keyword templates,<br/>city scoring, clustering<br/>Google Keyword Planner + Trends"]

        A2["Agent 2 — Design Research<br/>Phase 1: 6 research subagents<br/>Phase 2: competitor analysis,<br/>design spec, copy framework,<br/>schema templates, seasonal calendar"]

        A3["Agent 3 — Site Builder (Hybrid)<br/>packet → brief →<br/>content blocks → deterministic<br/>assembly → QA → Hugo build"]

        A7["Agent 7 — Monitor<br/>performance_snapshots + alerts<br/>health score, threshold rules,<br/>optimization_actions +<br/>follow-up agent_tasks"]
    end

    %% ===== Orchestrator =====
    subgraph ORCH[Orchestrator & Reliability]
        SCHED["task-scheduler.ts<br/>DAG of agent_tasks"]
        DLQ["DLQ manager<br/>(transient / permanent)"]
        CHK["Checkpoints<br/>agent_checkpoints table<br/>resumable sub-steps"]
        SH["withSelfHealing wrapper<br/>snapshot → repair → retry<br/>pipeline_run_log telemetry"]
        WD["Watchdog process<br/>(child of pipeline)<br/>clusters failures,<br/>writes learned_repair_patterns"]
        BUS["Event bus + WebSocket<br/>(dashboard live stream)"]
    end

    %% ===== Output =====
    subgraph OUT[Output]
        HUGO["Hugo site<br/>/hugo-site<br/>city hubs + service subpages<br/>+ legal pages<br/>(privacy, terms, do-not-sell)"]
        NET["Netlify deploy<br/>tracked phone numbers,<br/>TCPA disclosures,<br/>sticky mobile CTA"]
        DB[("PostgreSQL<br/>15 migrations<br/>agent_tasks, pages,<br/>content_items,<br/>performance_snapshots,<br/>ranking_snapshots,<br/>deployment_candidates,<br/>offer_geo_coverage, etc.")]
    end

    %% ===== Wiring =====
    OFFER --> OP
    VERT --> VP
    OP --> MERGE
    VP --> MERGE
    VP --> STRAT
    MERGE --> STRAT

    CLI --> PIPELINE
    DASH --> PIPELINE
    SUP -. spawns .-> CLI

    STRAT --> A1
    STRAT --> A2
    STRAT --> A3
    MERGE --> A05
    MERGE --> A7

    A05 --> A1
    A1 --> A2
    A2 --> A3
    A3 --> A7

    A1 --> ROUTER
    A2 --> ROUTER
    A3 --> ROUTER
    ROUTER --> CLAUDE
    ROUTER --> CODEX
    ROUTER --> GEMINI
    RATE --> ROUTER
    CB --> ROUTER

    PIPELINE --> SCHED
    SCHED --> DLQ
    SCHED --> CHK
    A05 --> SH
    A1 --> SH
    A2 --> SH
    A3 --> SH
    SH --> BUS
    PIPELINE -. spawns .-> WD
    WD --> DB
    SH --> DB

    A3 --> HUGO
    HUGO --> NET
    A7 --> DB
    A7 -->|follow-up tasks| SCHED

    BUS --> DASH
```

### How to read the current diagram

- **Entry points** all flow through the same core pipeline: `Agent 0.5 → Agent 1 → Agent 2 → Agent 3 → Agent 7`. `npm run pipeline` runs it as a direct script, `npm run orchestrate` runs it through the DAG-based `agent_tasks` scheduler, and the dashboard API exposes per-agent and full-pipeline triggers.
- **Profile resolution** sits in front of every agent. The offer profile and vertical profile are merged into a single runtime constraint set, and vertical strategies (`src/verticals/*`) own the prompt composition so a pest-control run is not the same as a generic run.
- **LLM infrastructure** is a cascade: `llm-client` talks to Claude / Codex / Gemini through Bottleneck rate limiters and Opossum circuit breakers, retries with Zod self-correction, and routes to DLQ on permanent failure. Agent 3 can run in `round-robin` mode across the three providers to parallelize page generation.
- **Reliability layer** is new. Every significant agent step is wrapped with `withSelfHealing`, which snapshots output, calls the LLM for a targeted repair, retries with backoff, and writes telemetry to `pipeline_run_log`. A separate **Watchdog** child process polls that log, clusters failures by `(agent, step, errorSignature)`, and writes learned repair patterns.
- **Output** is a Hugo project in `hugo-site/` that Netlify deploys. The database is the source of truth for every artifact the agents produced, and Agent 7 writes follow-up `agent_tasks` to close the optimization loop.

---

## Future architecture

This is what PRD v9, the gap plans, the Agent 1 playbook, the two-pipeline market model, and the deferred-items list in `designdecisions.md` describe. New surfaces are marked. Agents that exist but are materially expanded are marked too.

```mermaid
flowchart TB
    subgraph NEW_MARKET[NEW: Market Intelligence Layer]
        A0["Agent 0 — Market Scanner (NEW)<br/>Census ACS/CBSA, NOAA climate,<br/>HUD TIP zones, Frostline<br/>→ standalone cities + suburb candidates"]
        FRANCHISE["Franchise & Competition Scan (NEW)<br/>Orkin / Terminix / Aptive coverage,<br/>Places API, Moz DA, PageSpeed"]
        PAYOUT["Payout Intelligence (NEW)<br/>offer network feeds,<br/>call network data"]
    end

    subgraph UPGRADED[Upgraded Agents]
        A05_V2["Agent 0.5 — Geo Scanner (EXPANDED)<br/>+ two-pipeline model:<br/>standalone_city vs suburb<br/>+ metro_parent & cluster metadata<br/>+ search identity confidence<br/>+ pest pressure score<br/>+ monetization score"]

        A1_V2["Agent 1 — Keywords (EXPANDED)<br/>+ cache versioning<br/>(estimated vs Google Ads API)<br/>+ niche expansion per market<br/>(wildlife, bed bugs, commercial)<br/>+ composite city & suburb scoring"]

        A2_V2["Agent 2 — Design (EXPANDED)<br/>+ per-vertical prompt stacks<br/>(pest / HVAC / roofing)<br/>+ full playbook enforcement<br/>(5 archetypes, trust placement,<br/>CTA repetition, reading level)"]

        A3_V2["Agent 3 — Builder (EXPANDED)<br/>+ all 40 gap-plan fixes<br/>(dynamic CTAs, trust signals,<br/>schema, breakpoints, section rules,<br/>process steps, seasonal banner)<br/>+ stronger uniqueness gate<br/>+ hard-fail compliance QA"]

        A7_V2["Agent 7 — Monitor (EXPANDED)<br/>+ real GSC / GA4 / MarketCall<br/>+ indexation kill switch<br/>+ vertical-aware remediation<br/>+ portfolio health + rebalancing"]
    end

    subgraph NEW_OPS[NEW: Portfolio Operations]
        QUEUE["Opportunity Queue (NEW)<br/>DB-backed, replaces<br/>hardcoded city arrays<br/>interleaves 2 suburbs : 1 city"]
        RELEASE["Release Control (NEW)<br/>separates build vs publish<br/>scheduled release windows<br/>creation is uncapped,<br/>publication is gated"]
        VUI["Vertical / Offer Dashboard UI (NEW)<br/>author + edit vertical definitions<br/>without CLI"]
        AGENT8["Agent 8 — Link / Authority (NEW)<br/>backlink acquisition,<br/>citation consistency"]
        REPORT["Revenue & Portfolio Reporting (NEW)<br/>monthly ROI per site,<br/>sunset / maintain / optimize"]
    end

    subgraph LOOP[Closed-Loop Optimization]
        OPT["optimization_actions<br/>+ deduped follow-up<br/>agent_tasks"]
        DECIDE["Decision tree:<br/>indexing → ranking → CTR →<br/>conversion → revenue"]
    end

    subgraph SHARED[Platform (unchanged surfaces)]
        ORCH2["Orchestrator + DLQ + Scheduler"]
        SH2["Self-Healing + Watchdog + Checkpoints"]
        LLM2["Multi-LLM router<br/>(Claude / Codex / Gemini)"]
        HUGO2["Hugo + Netlify"]
        DB2[("PostgreSQL<br/>+ opportunity_queue<br/>+ release_schedule<br/>+ link_targets<br/>+ revenue_rollups")]
    end

    A0 --> A05_V2
    FRANCHISE --> A0
    PAYOUT --> A0
    A05_V2 --> QUEUE
    QUEUE --> A1_V2
    A1_V2 --> A2_V2
    A2_V2 --> A3_V2
    A3_V2 --> RELEASE
    RELEASE --> HUGO2
    HUGO2 --> A7_V2
    A7_V2 --> DECIDE
    DECIDE --> OPT
    OPT --> A1_V2
    OPT --> A3_V2
    OPT --> AGENT8
    AGENT8 --> A3_V2
    A7_V2 --> REPORT

    VUI --> A2_V2
    VUI --> QUEUE

    A05_V2 --> SH2
    A1_V2 --> SH2
    A2_V2 --> SH2
    A3_V2 --> SH2
    A7_V2 --> SH2
    SH2 --> ORCH2
    ORCH2 --> DB2
    LLM2 --> A1_V2
    LLM2 --> A2_V2
    LLM2 --> A3_V2

    classDef new fill:#ffe4a8,stroke:#c47a00,stroke-width:2px,color:#222
    classDef expanded fill:#c6e2ff,stroke:#2b6cb0,stroke-width:2px,color:#222
    classDef shared fill:#eeeeee,stroke:#555,color:#222
    class A0,FRANCHISE,PAYOUT,QUEUE,RELEASE,VUI,AGENT8,REPORT new
    class A05_V2,A1_V2,A2_V2,A3_V2,A7_V2 expanded
    class ORCH2,SH2,LLM2,HUGO2,DB2,OPT,DECIDE shared
```

### What changes in the future state

**New surfaces (orange):**

- **Agent 0 — Market Scanner.** Today Agent 0.5 starts from a ZIP list the operator uploaded. The future state pulls candidate cities and suburbs directly from Census ACS + CBSA, filters by homeownership, income, growth, and single-family density, then layers NOAA temperature / precipitation, HUD TIP zones, and USDA hardiness zones to compute a **pest pressure score** before Agent 0.5 even runs. That is the "standalone-city + suburb" two-pipeline playbook described in `agent1playbookplan.md`.
- **Franchise & competition intelligence.** Automated scans of Orkin / Terminix / Aptive location finders, Google Places, Moz DA, PageSpeed, and SERP features, feeding the deterministic competition score in Agent 0.5 and the CPC / monetization viability check in Agent 1.
- **Payout intelligence.** Hooks for pay-per-call network data so scoring can become expected-value-aware instead of flat-payout-aware.
- **Opportunity Queue.** Replaces the hardcoded `CANDIDATE_CITIES` array in `src/index.ts` with a DB-backed queue that interleaves `2 suburbs : 1 standalone city` for faster cash flow.
- **Release Control.** Today Agent 3's weekly new-city cap is disabled because it was gating *creation*, not *publication*. The future state enforces creation as uncapped and gates a separate release layer — scheduled windows, staged content, explicit "launch" action. This matches the "Content Creation Must Not Be Capped" rule in `designdecisions.md`.
- **Vertical / Offer Dashboard UI.** Today vertical and offer profiles are authored via CLI only. The future state adds a dashboard UI for the same flows, including banned-service enumeration.
- **Agent 8 — Link / Authority.** The PRD rebalancing tree references backlink acquisition as a distinct remediation path; that is not implemented yet.
- **Revenue & Portfolio Reporting.** Monthly rollups with explicit maintain / optimize / sunset decisions per site.

**Expanded agents (blue):**

- **Agent 0.5.** Today it produces a single deterministic shortlist with coverage, population, density, spread, and deployment-fit scores. Future state adds `pipeline: standalone_city | suburb`, `metro_parent`, `cluster`, `search_identity_confidence`, `competition_score`, `pest_pressure_score`, and `monetization_score` as first-class fields and uses them in ranking.
- **Agent 1.** Deep research is already in place (4 subagents: keyword-patterns, market-data, competitor-keywords, local-seo). What's deferred: cache source versioning (distinguishing LLM-estimated volumes from Google Ads API volumes), per-market niche expansion (wildlife removal, bed bug treatment, commercial, termite, rodent, mosquito), and the composite suburb vs city scoring from the playbook.
- **Agent 2.** Deep research is in place (6 subagents). What's deferred: full per-vertical prompt stacks. Today the `pest-control` strategy owns its Agent 1/2/3 prompts, but `hvac` and `roofing` still share the default generic strategy. The upgraded state finishes that split and enforces the full 5-archetype playbook with trust-placement hierarchy, CTA repetition, and reading-level targets.
- **Agent 3.** Hybrid architecture (packet → brief → content blocks → deterministic assembly) is already in place. What's deferred: all 40 items in `gapplan.md` — dynamic CTAs from Agent 2's copy framework, dynamic trust signals, schema markup rendering, responsive breakpoints, section rules, data-driven process steps, seasonal banner, frontmatter banned-phrase scanning, a stronger uniqueness gate using structured local facts, and compliance QA that hard-fails on banned service tokens instead of silently normalizing.
- **Agent 7.** Today metrics come from mocks or a database-backed provider; Search Console integration is feature-flagged off. The upgrade wires GSC, GA4, and MarketCall providers, turns on the indexation kill switch, and makes remediation vertical-aware so HVAC and roofing don't get pest-control fix recipes.

**Closed-loop optimization (grey, already partly wired):**

The V9 addendum already converts `optimization_actions` into deduplicated follow-up `agent_tasks`:

- `content_refresh` → Agent 3
- `cta_optimization` → Agent 3
- `keyword_refinement` → Agent 1

The future state expands the decision tree (indexing → ranking → CTR → conversion → revenue) with real data.

---

## Agents in detail

### Agent 0.5 — Geo Opportunity Scanner
`src/agents/agent-0.5-geo-scanner/`

Deterministic geo filter. Ingests an offer's allowed ZIP list, normalizes it, maps ZIPs to cities via `geo_zip_reference`, aggregates into coverage clusters, scores every cluster (`coverage_score + population_score + density_score + spread_penalty + deployment_fit_score`), and writes ranked `deployment_candidates` rows. Refuses to trust the geo reference table if it has fewer than ~30,000 rows and auto-imports if so. Checkpoints the scan so reruns skip already-scored candidate sets.

### Agent 1 — Keyword Research
`src/agents/agent-1-keywords/`

Phase 1 is deep research via the Claude Agent SDK — four parallel subagents (`keyword-pattern-researcher`, `market-data-researcher`, `competitor-keyword-researcher`, `local-seo-researcher`) write findings files under `tmp/agent1-research/{runId}/`. Phase 2 reads those files, generates keyword templates (`KEYWORD_TEMPLATE_PROMPT` with research context), expands per shortlisted city, pulls Google Keyword Planner + Google Trends metrics, LLM-scores cities, clusters keywords, and writes `city_keyword_map` + `keyword_clusters`. Keyword templates and city scoring calls are wrapped in `withSelfHealing`. Checkpointed per city.

### Agent 2 — Design Research
`src/agents/agent-2-design/`

Phase 1 is deep research via six subagents covering competitors, CRO, design, copy, schema, and seasonal. Phase 2 synthesizes: competitor analysis, design spec, copy framework, schema templates, seasonal calendar — each as its own LLM call with its own Zod schema. Cached per niche so it only reruns when research becomes stale. Research failures are loud (agent emits `agent_error`) and can fall back cleanly via the `AGENT2_RESEARCH_ENABLED` kill switch.

### Agent 3 — Site Builder (Hybrid)
`src/agents/agent-3-builder/`

Core production agent. Stages:

1. **Hugo template generation** — Sonnet (not Haiku) generates `baseof.html`, `list.html`, `single.html` from the Agent 2 design spec. Templates go through structural review, deterministic stylesheet-link enforcement, cache, and a real `hugo` validation run before any content is built.
2. **Page packet build** — compact structured input per page (city, state, target keyword, service, allowed pests, seasonal signals, local facts, trust signals, approved CTA).
3. **Brief** — fast model produces a short structured brief per page (angle, headings, local facts, FAQ topics, word allocation). Cached.
4. **Variable content blocks** — intro, local-conditions, seasonal, treatment, cost, FAQ, CTA support. Bounded page concurrency (`AGENT3_CITY_CONCURRENCY`).
5. **Deterministic assembly** — frontmatter + partials + stable modules + generated blocks. Legal and compliance scaffolding live here, not in prompts.
6. **Quality gate** — word count, city mention density, banned phrases, placeholder tokens, phone mention count, supplemental-text scanning. Repairable classes auto-rewrite; up to two repair attempts before a degraded fallback.
7. **Cross-page diversity guard** — similarity history is seeded from existing Hugo content at startup, so new pages don't repeat language from previous runs.
8. **Hugo build + Netlify deploy.**

### Agent 7 — Performance Monitor
`src/agents/agent-7-monitor/`

Pulls metrics via a `DataProvider` interface (Mock, DatabaseBacked, or SearchConsole). Writes `performance_snapshots` and `ranking_snapshots`, computes a portfolio health score, evaluates thresholds, inserts `alerts`, writes `optimization_actions`, and — the V9 closed-loop change — inserts deduplicated follow-up rows into `agent_tasks` so the orchestrator can dispatch remediation (`content_refresh`, `cta_optimization`, `keyword_refinement`).

### Agent Watchdog
`src/agents/agent-watchdog/`

Child process spawned on pipeline boot. Polls `pipeline_run_log` every 60s, clusters failures by `(agent_name, step, error_signature)`, asks the LLM for a root-cause diagnosis only when a cluster crosses threshold, and writes patterns to `learned_repair_patterns` + appends a human-readable audit trail to `docs/watchdog/learned-patterns.md`.

### Supervisor
`src/supervisor.ts`

Outer layer. Spawns the pipeline as a child, captures tailing stdout/stderr, retries with exponential backoff (up to `MAX_RETRIES`), and diagnoses crashes via a `CrashDiagnosisSchema` LLM call (`oom | timeout | llm_failure | db_failure | file_io | validation | unhandled | signal | unknown`).

---

## Data model

PostgreSQL, managed via in-process migrations in `src/shared/db/migrations/`:

| Area | Tables |
|---|---|
| Orchestration | `agent_tasks`, `dead_letter_queue`, `agent_checkpoints`, `pipeline_run_log`, `learned_repair_patterns`, `pipeline_crashes` |
| Geo | `geo_zip_reference`, `offer_geo_coverage`, `deployment_candidates` |
| Keywords | `keyword_templates`, `keyword_clusters`, `city_keyword_map`, `research_cache` (with provenance) |
| Design | `design_specs`, `copy_frameworks`, `schema_templates`, `seasonal_calendar` |
| Content | `content_items`, `pages`, `site_builds`, `agent3_hybrid_cache` |
| Performance | `performance_snapshots`, `ranking_snapshots`, `call_records`, `alerts`, `optimization_actions` |
| Profiles | `vertical_profiles`, `offer_profiles` |

All writes are Zod-validated via schemas in `src/shared/schemas/`.

---

## Orchestration, self-healing, and observability

- **Task scheduler** (`src/orchestrator/task-scheduler.ts`) — DAG over `agent_tasks`, states `pending → running → completed | failed → dlq`.
- **DLQ manager** (`src/orchestrator/dlq-manager.ts`) — classifies errors as `transient | permanent | unknown`, deduplicates by SHA-256 fingerprint, exponential backoff up to 3 retries.
- **Checkpoints** (`src/shared/checkpoints.ts`) — every agent persists substep completion so reruns skip done work.
- **Self-healing** (`src/shared/self-healing.ts`) — snapshot before, LLM repair on failure, retry with backoff, emit `agent_step` on repair and `agent_error` on permanent failure. Results land in `pipeline_run_log` and bubble to the dashboard over the event bus.
- **Watchdog** — clusters failures across runs, turns repeated errors into learned patterns.
- **Event bus + WebSockets** (`src/shared/events/`, `src/dashboard-server.ts`) — streams `agent_start`, `agent_step`, `agent_complete`, `agent_error`, `task_status_change`, `pipeline_run`, `health_score` live.
- **Rate limiting + circuit breaking** — Bottleneck per provider (Claude / Codex / Gemini), Opossum opens after 3 consecutive failures and half-opens after 60s.

---

## Vertical and offer model

Two independent layers:

- **Vertical profile** — reusable playbook for a niche. Stored in `vertical_profiles`, editable via `tsx src/index.ts vertical-profile <verticalKey> <json-or-file>`. Defines core services, exclusions, default service scope, banned phrases, keyword guidance, design guidance.
- **Offer profile** — monetization-specific overlay. Stored in `offer_profiles`, ingestible via CLI (`offer-profile <offerId> <raw-text-or-file>`) or dashboard API (`POST /api/offers/profile`). Defines allowed / disallowed services, required disclaimer, traffic restrictions, target call duration, and ZIP spreadsheet sources (with case-preserving URL parsing — Google Sheets IDs are case-sensitive).

At runtime, `mergeOfferConstraints` produces the authoritative constraint set every agent reads. Vertical **strategies** (`src/verticals/pest-control/strategy.ts`, `src/verticals/default/strategy.ts`) own prompt composition so agents delegate rather than inline prompt building.

---

## Quality and compliance guardrails

- **No forms, phone-only conversion.** Enforced in templates, in prompts, and in QA (form-language banned patterns: `"fill out"`, `"submit your"`, `"request a quote online"`, etc.).
- **TCPA + referral disclosure.** Footer disclaimer, CTA-adjacent call-recording notices, permanent links to `/privacy-policy/`, `/terms-of-service/`, `/do-not-sell/`.
- **City mention density.** Pages must mention the city multiple times; threshold scales with content length.
- **Banned AI phrases.** `"when it comes to"`, generic filler detection, frontmatter scanning.
- **Placeholder token enforcement.** Checkpointed files with unresolved placeholders are invalidated and regenerated rather than reused.
- **Template validation.** Generated Hugo templates must pass structural review + real `hugo` validation before any content uses them. Poisoned cache entries are discarded.
- **Cross-page diversity.** Similarity history is seeded from existing Hugo content at run start.

---

## Roadmap

Directly from `CallForge PRD v9.md § 25.8`, `designdecisions.md`, and the gap plans:

- [ ] Agent 0 — full Census/CBSA/NOAA/HUD market scanner feeding Agent 0.5
- [ ] Database-backed opportunity queue (replace hardcoded `CANDIDATE_CITIES`)
- [ ] Two-pipeline (`standalone_city` + `suburb`) scoring + ranking
- [ ] Release layer separated from content creation (scheduled publication windows)
- [ ] Payout-aware scoring from network intelligence
- [ ] Cache source versioning (estimated vs. Google Ads API)
- [ ] Real Agent 7 data providers (GSC + GA4 + MarketCall) replacing mocks
- [ ] Indexation kill switch driven by Search Console / URL Inspection
- [ ] Stronger uniqueness gate using structured local facts + similarity scoring
- [ ] Full pest-control playbook compliance in Agent 3 (40 gap-plan items)
- [ ] Per-vertical prompt stacks for HVAC and roofing (today they fall back to default)
- [ ] Dashboard UI for authoring vertical / offer profiles
- [ ] Compliance QA that hard-fails on exact banned service tokens
- [ ] Agent 8 — link / authority acquisition
- [ ] Revenue & portfolio reporting with maintain / optimize / sunset decisions

---

## Local setup

Requires Node 20+, PostgreSQL (the project expects `postgres://callforge:callforge@localhost:5434/callforge` by default), and at least one of the Claude / Codex / Gemini CLIs installed.

```bash
# 1. Start Postgres
docker-compose up -d

# 2. Install deps
source ~/.nvm/nvm.sh && npm install

# 3. Configure env
cp .env.example .env
# then fill in CLI paths + API keys

# 4. Apply migrations
npm run migrate

# 5. Import geo data (needed by Agent 0.5)
npm run import:geo-zips

# 6. Optional: import sample pest control offers
npm run import:pest-offers
```

---

## Commands

```bash
# Individual agents
npm run agent:1 -- <offerId>
npm run agent:2 -- <offerId>
npm run agent:3 -- <offerId>
npm run agent:7 -- <offerId>

# Full pipeline (Agent 0.5 → 1 → 2 → 3)
npm run pipeline -- <offerId>

# Orchestrated run (same flow via DAG scheduler)
npx tsx src/index.ts orchestrate

# Supervised run (auto-restart + crash diagnosis)
npx tsx src/index.ts supervise <offerId>

# Dashboard
npm run dashboard        # API + WebSocket server
npm run dashboard:ui     # React UI (Vite)

# Tests
npm test

# Profile authoring
npx tsx src/index.ts vertical-profile pest-control ./path/to/vertical.json
npx tsx src/index.ts offer-profile pestcontrol-1 ./path/to/offer.txt
```

---

## Repository map

```
parallel-callforge/
├── src/
│   ├── index.ts                      # CLI entry (pipeline, orchestrate, supervise, agent:*)
│   ├── supervisor.ts                 # Process-level supervisor + crash diagnosis
│   ├── dashboard-server.ts           # Express + WebSocket dashboard API
│   ├── agents/
│   │   ├── agent-0.5-geo-scanner/
│   │   ├── agent-1-keywords/         # deep research + synthesis
│   │   ├── agent-2-design/           # deep research + 5 synthesis passes
│   │   ├── agent-3-builder/          # hybrid architecture
│   │   ├── agent-7-monitor/          # thresholds, health score, providers
│   │   └── agent-watchdog/           # failure clustering + learned patterns
│   ├── orchestrator/                 # task-scheduler + DLQ
│   ├── shared/
│   │   ├── cli/                      # claude/codex/gemini + llm-client + rate-limiter
│   │   ├── db/                       # client + 15 migrations + importers
│   │   ├── events/                   # event bus + WebSocket event types
│   │   ├── schemas/                  # Zod schemas mirroring DB tables
│   │   ├── checkpoints.ts
│   │   ├── self-healing.ts
│   │   ├── circuit-breaker.ts
│   │   ├── cache-policy.ts
│   │   ├── offer-profiles.ts
│   │   ├── vertical-profiles.ts
│   │   └── vertical-strategies.ts
│   ├── verticals/                    # pest-control strategy + default strategy
│   └── config/                       # env + rate-limits
├── hugo-site/                        # generated Hugo project (live cities + legal pages)
├── dashboard/                        # React + Vite + Tailwind dashboard UI
├── docs/
│   ├── plans/                        # phase plans (hybrid, deep research, watchdog, etc.)
│   ├── audits/
│   └── watchdog/learned-patterns.md  # watchdog audit trail
├── CallForge PRD v7.docx
├── CallForge PRD v8.docx
├── CallForge PRD v9.md               # current spec of record
├── designdecisions.md                # living architecture notes
├── gapplan.md                        # 40 Agent 2 → Agent 3 → Hugo conversion gaps
├── agent0.5plan.md
├── agent1playbookplan.md             # two-pipeline market playbook
├── agent2playbookplan.md
├── pipelineaudit.md                  # audit prompt used against the codebase
├── pipefix.md                        # post-audit fix checklist (all P0/P1/P2/P3/P4 done)
└── README.md                         # this file
```

---

## License & authorship

Internal / build-in-public. Author: Kioja Kudumu.

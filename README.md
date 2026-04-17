# CallForge — Parallel CallForge

**AI-powered multi-agent system for programmatic pay-per-call lead generation.**

CallForge spins up local-service websites (starting with pest control) at the city level, optimizes them for organic search, and converts visitors directly into phone calls that are monetized via pay-per-call affiliate networks. The whole pipeline — market selection, keyword research, design research, page generation, deployment, and performance monitoring — is run by cooperating agents backed by PostgreSQL, the Claude / Codex / Gemini CLIs, and Hugo.

- **First deployment target:** `extermanation.com` (pest control)
- **Spec of record:** `CallForge PRD v9.md` + the V7 / V8 PRDs (build-in-public)
- **Mode:** organic-first, phone-only conversion, no forms, TCPA-compliant templates
- **Status:** MVP producing live cities (Shawnee, Deland, Lenexa, Athens, Port Orange) with research, hybrid content generation, self-healing, and a watchdog loop all wired up

### The full agent roster

PRD v7 designed **10 numbered agents (0 through 9)**. V9 added a deterministic pre-filter, Agent 0.5, for a total of **11 numbered agents** plus the Watchdog and Supervisor infrastructure processes.

| # | Agent | Role | Status |
|---|---|---|---|
| 0 | Network Intelligence | Monitors pay-per-call networks (MarketCall, Ringba) for offers, payouts, ZIP-level bid maps | Designed (PRD v7 §3), **not implemented** |
| 0.5 | Geo Opportunity Scanner | Deterministic ZIP → city shortlist before expensive keyword research | ✅ **Implemented** |
| 1 | Keyword Research + City Strategy | Keyword templates, city scoring, clustering, deep research subagents | ✅ **Implemented** |
| 2 | Niche & Design Research | Competitor, design spec, copy framework, schema, seasonal calendar | ✅ **Implemented** |
| 3 | Site Builder | Hugo templates + hybrid content generation + QA + deploy | ✅ **Implemented** |
| 4 | Social Media Content Engine | COPE (Create Once, Publish Everywhere) across 6 platforms | Designed (PRD v7 §7), **not implemented** |
| 5 | Blog Content Engine | SEO-optimized blog posts with persona rotation, AI-detector defenses | Designed (PRD v7 §8), **not implemented** |
| 6 | Social Media Engagement Responder | Tiered response to comments / mentions / DMs | Designed (PRD v7 §9), **not implemented** |
| 7 | Performance Monitor + Rebalancer | GSC / GA4 / MarketCall ingest, thresholds, health score, closed-loop remediation | ✅ **Implemented** (mock/DB providers; GSC behind a flag) |
| 8 | Backlink & Citation Builder | NAP consistency, free aggregators, industry directories, white-hat link building | Designed (PRD v7 §11), **not implemented** |
| 9 | Google Ads Manager | Call-Only Ads, bid management from MarketCall payouts, geo-targeting | Designed (PRD v7 §12, Phase 2), **not implemented** |
| — | Watchdog | Child process; clusters failures, writes `learned_repair_patterns` | ✅ **Implemented** |
| — | Supervisor | Outer process; respawns pipeline, LLM-diagnoses crashes | ✅ **Implemented** |

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

This is what is actually implemented and wired up on `master` today: **5 of the 11 designed agents** (0.5, 1, 2, 3, 7) plus the Watchdog + Supervisor. Agents 0, 4, 5, 6, 8, and 9 are designed in PRD v7 but not yet built — they show up in the future-state diagram below.

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
    subgraph ORCH["Orchestrator and Reliability"]
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
    subgraph INTEL["NEW — Network & Market Intelligence"]
        A0["Agent 0 — Network Intelligence<br/>(NEW, PRD v7 §3)<br/>MarketCall + Ringba scrapers,<br/>Keitaro reporting, postbacks,<br/>ZIP-level bid maps,<br/>payout + offer catalog"]
        MKT["Market Scanner<br/>Census ACS/CBSA, NOAA,<br/>HUD TIP, Frostline,<br/>Moz DA, Places API"]
        FRANCHISE["Franchise Detection<br/>Orkin / Terminix / Aptive"]
    end

    subgraph DISCOVERY["Discovery and Planning"]
        A05_V2["Agent 0.5 — Geo Scanner (EXPANDED)<br/>two-pipeline model<br/>(standalone_city vs suburb),<br/>metro parent, cluster metadata,<br/>search identity, pest pressure,<br/>monetization score"]
        QUEUE["Opportunity Queue (NEW)<br/>DB-backed, interleaves<br/>2 suburbs : 1 city"]
        A1_V2["Agent 1 — Keywords (EXPANDED)<br/>cache source versioning,<br/>per-market niche expansion<br/>(wildlife, bed bugs, commercial),<br/>composite city + suburb scoring"]
        A2_V2["Agent 2 — Design (EXPANDED)<br/>per-vertical prompt stacks<br/>(pest / HVAC / roofing),<br/>full playbook: 5 archetypes,<br/>trust placement, CTA repetition,<br/>reading level"]
    end

    subgraph BUILD["Build and Publish"]
        A3_V2["Agent 3 — Site Builder (EXPANDED)<br/>all 40 gap-plan fixes,<br/>stronger uniqueness gate,<br/>hard-fail compliance QA"]
        A5["Agent 5 — Blog Content (NEW, PRD v7 §8)<br/>section-by-section generation,<br/>persona rotation, AI-detector defenses,<br/>local data injection, Git → Netlify"]
        RELEASE["Release Control (NEW)<br/>build vs publish split,<br/>scheduled release windows"]
        HUGO2["Hugo + Netlify"]
    end

    subgraph DISTRIBUTE["Distribution and Authority"]
        A4["Agent 4 — Social Media Content (NEW, PRD v7 §7)<br/>COPE engine, 6 platforms<br/>(Facebook, Instagram, X, TikTok,<br/>YouTube, LinkedIn), FFmpeg + Puppeteer"]
        A6["Agent 6 — Social Engagement (NEW, PRD v7 §9)<br/>tiered responder<br/>(auto / template / escalate / ignore)"]
        A8["Agent 8 — Backlink + Citation (NEW, PRD v7 §11)<br/>NAP consistency, Express Update,<br/>Foursquare, GBP, Yelp, industry directories,<br/>HARO, guest posts"]
        A9["Agent 9 — Google Ads Manager (NEW, PRD v7 §12)<br/>Call-Only Ads, ZIP geo-targeting,<br/>bids from MarketCall payouts,<br/>dayparting 7am–7pm"]
    end

    subgraph FEEDBACK["Feedback and Optimization"]
        A7_V2["Agent 7 — Monitor (EXPANDED)<br/>real GSC / GA4 / MarketCall,<br/>indexation kill switch,<br/>vertical-aware remediation"]
        DECIDE["Decision tree:<br/>indexing → ranking → CTR →<br/>conversion → revenue"]
        OPT["optimization_actions<br/>+ deduped follow-up<br/>agent_tasks"]
        REPORT["Revenue & Portfolio Reporting (NEW)<br/>maintain / optimize / sunset"]
    end

    subgraph SHARED["Platform — unchanged surfaces"]
        ORCH2["Orchestrator + DLQ + Scheduler"]
        SH2["Self-Healing + Watchdog + Checkpoints"]
        LLM2["Multi-LLM router<br/>(Claude / Codex / Gemini)"]
        VUI["Vertical / Offer Dashboard UI (NEW)"]
        DB2[("PostgreSQL<br/>+ opportunity_queue<br/>+ release_schedule<br/>+ offer_catalog<br/>+ bid_maps<br/>+ link_targets<br/>+ social_posts<br/>+ revenue_rollups")]
    end

    %% Intelligence → discovery
    A0 --> A1_V2
    A0 --> A9
    MKT --> A05_V2
    FRANCHISE --> A05_V2
    A05_V2 --> QUEUE
    QUEUE --> A1_V2
    A1_V2 --> A2_V2
    A2_V2 --> A3_V2
    A2_V2 --> A5

    %% Build → publish
    A3_V2 --> RELEASE
    A5 --> RELEASE
    RELEASE --> HUGO2

    %% Distribution
    A5 --> A4
    A4 --> A6
    HUGO2 --> A8
    A0 --> A9

    %% Feedback
    HUGO2 --> A7_V2
    A4 --> A7_V2
    A9 --> A7_V2
    A7_V2 --> DECIDE
    DECIDE --> OPT
    OPT --> A1_V2
    OPT --> A3_V2
    OPT --> A5
    OPT --> A8
    OPT --> A9
    A7_V2 --> REPORT

    %% Platform
    VUI --> A2_V2
    VUI --> QUEUE
    A05_V2 --> SH2
    A1_V2 --> SH2
    A2_V2 --> SH2
    A3_V2 --> SH2
    A5 --> SH2
    A7_V2 --> SH2
    A8 --> SH2
    A9 --> SH2
    SH2 --> ORCH2
    ORCH2 --> DB2
    LLM2 --> A1_V2
    LLM2 --> A2_V2
    LLM2 --> A3_V2
    LLM2 --> A5
    LLM2 --> A6

    classDef new fill:#ffe4a8,stroke:#c47a00,stroke-width:2px,color:#222
    classDef expanded fill:#c6e2ff,stroke:#2b6cb0,stroke-width:2px,color:#222
    classDef shared fill:#eeeeee,stroke:#555,color:#222
    class A0,MKT,FRANCHISE,QUEUE,RELEASE,VUI,A4,A5,A6,A8,A9,REPORT new
    class A05_V2,A1_V2,A2_V2,A3_V2,A7_V2 expanded
    class ORCH2,SH2,LLM2,HUGO2,DB2,OPT,DECIDE shared
```

### What changes in the future state

**New agents (orange) — designed in PRD v7 but not yet implemented:**

- **Agent 0 — Network Intelligence (PRD v7 §3).** The missing upstream layer. Monitors pay-per-call networks (MarketCall as primary, Ringba as secondary) for active offers, payout rates, and geographic availability. The core insight: payouts are dynamic, not fixed, and vary 3–5× between ZIP codes for the same vertical. Agent 0 captures **ZIP-level bid maps** and feeds them into Agent 1's market scoring and Agent 9's bid strategy. Implementation involves MarketCall postbacks (primary data channel), Playwright-based authenticated scraping of the offer catalog (fallback), Ringba REST API + BrightCall discovery for secondary inventory. Feeds the `offer_catalog` and `bid_maps` tables.
- **Agent 4 — Social Media Content Engine (PRD v7 §7).** A COPE (Create Once, Publish Everywhere) engine that transforms each Agent 5 blog post into 5–6 platform-native social posts across Facebook Pages, Instagram, X/Twitter, TikTok, YouTube, and LinkedIn. Generates images via Puppeteer and videos via FFmpeg; publishes on $0/month using Late's free tier + direct platform APIs.
- **Agent 5 — Blog Content Engine (PRD v7 §8).** SEO-optimized blog publishing. Generates each article **section by section** (not monolithic) with persona rotation (Jake Morrison, Maria Chen, Carlos Reyes), temperature ≥ 0.85, explicit AI-detector defenses (banned phrase list, burstiness enforcement, contrarian opinions), and local data injection. Publishes Git → Netlify, same deploy path as Agent 3.
- **Agent 6 — Social Media Engagement Responder (PRD v7 §9).** Tiered responder for comments, mentions, DMs: **Tier 1 auto-reply** for generic comments, **Tier 2 template + personalize** for service inquiries, **Tier 3 human escalation** for complaints / emergencies / negative reviews, **Tier 4 never engage** for trolls / politics. Hard rules: never promise pricing, never claim to be a pest control company, never engage hostility publicly.
- **Agent 8 — Backlink & Citation Builder (PRD v7 §11).** NAP consistency + white-hat link acquisition: free aggregator submissions (Express Update, Foursquare, GBP), major directory claims (Yelp, Bing Places, Apple Business Connect, Angi, Thumbtack, Manta, Hotfrog), industry directories (NPMA, state pest associations), HARO responses, guest posts. Target: 25–30 quality citations per city at $0 cost within 2–3 weeks of deployment.
- **Agent 9 — Google Ads Manager (PRD v7 §12, Phase 2).** Paid acquisition running in parallel with organic. Call-Only Ads, ZIP-level geo-targeting matched to MarketCall's payout zones, bid targets set to `payout × 0.4` for 60% margin, dayparting 7am–7pm local, negative keyword management to exclude DIY/jobs/informational intent. Organic is slow (3–6 months to rank), so Agent 9 provides immediate call volume while Agent 3 + Agent 8 build authority.

**New platform pieces (orange) — not tied to a single agent:**

- **Opportunity Queue.** Replaces the hardcoded `CANDIDATE_CITIES` array in `src/index.ts` with a DB-backed queue that interleaves `2 suburbs : 1 standalone city` for faster cash flow.
- **Release Control.** Agent 3's weekly new-city cap is currently disabled because it was gating *creation*, not *publication*. The future state keeps creation uncapped and gates a separate release layer — scheduled windows, staged content, explicit launch action (per `designdecisions.md`).
- **Vertical / Offer Dashboard UI.** Today profiles are authored via CLI only; the UI adds the same flows plus banned-service enumeration.
- **Revenue & Portfolio Reporting.** Monthly rollups with explicit maintain / optimize / sunset decisions per site.
- **Market Scanner + Franchise Detection.** Automated scans of Census ACS + CBSA, NOAA climate, HUD TIP zones, Frostline USDA, Moz DA, Places API, Orkin / Terminix / Aptive location finders — all feeding Agent 0.5's deterministic scoring.

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

### Agent 0 — Network Intelligence _(designed, not implemented)_
`PRD v7 §3`

Programmatic monitor of pay-per-call networks. Sole job: keep the system aware of which offers exist, what they pay **today**, which ZIPs have active buyers, and when payouts change.

- **MarketCall (primary).** Cookie-session login at `/auth/login`, postbacks configured at `/affiliate/postbacks/create` as the **primary data channel** (macros: `{call_id}`, `{earn}`, `{state}`, `{subid}`...`{subid6}`, `{date}`, `{fbclid}`), call status codes (`Approved`, `HOLD`, `Refused by Merchant`, `Tarificated`, `Parsed`, `Non-qualified`), DNI setup at `/v2/affiliate/call-tracking/sites`. Offer catalog lives only in the authenticated dashboard, so Agent 0 uses Playwright with persistent context + XHR interception (not DOM scraping) as a secondary channel, respecting 3–8s random delays and twice-daily max frequency.
- **Ringba (secondary / infrastructure).** REST API for campaign + call management. Used when operating as a Ringba-first infrastructure layer that resells into MarketCall or direct advertisers.
- **Output.** `offer_catalog` and `bid_maps` tables keyed by (network, offer, ZIP), consumed by Agent 1 (monetization viability scoring) and Agent 9 (bid targets).

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

### Agent 4 — Social Media Content Engine _(designed, not implemented)_
`PRD v7 §7`

COPE engine that converts every Agent 5 blog post into 5–6 platform-native derivatives.

- **Platforms.** Facebook Pages + Instagram (Meta Graph API v22.0, free — permissions: `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`), X/Twitter (1,500 free posts/mo), TikTok Content Posting API (requires audit), YouTube Data API v3 (10,000 quota units/day), LinkedIn.
- **Asset generation.** Puppeteer renders quote cards / stat cards / blog-cover images to PNG. FFmpeg stitches stills + Kokoro TTS voiceovers into short-form Reels / TikToks / YouTube Shorts.
- **Scheduling & cost.** Late free tier (20 posts/mo) for unified scheduling across accounts; $19/mo on Build plan when scaling.
- **Output.** `social_posts` table linking Hugo slugs to each platform post ID for downstream attribution in Agent 7.

### Agent 5 — Blog Content Engine _(designed, not implemented)_
`PRD v7 §8`

Publishes SEO-optimized long-form blog posts through the same Git → Netlify pipeline Agent 3 uses.

- **Section-by-section generation.** Every article is decomposed into intro + H2 sections + conclusion, each a separate Claude Code CLI call with different persona instructions and temperature settings. This is the "burstiness" that defeats AI-detectors — statistical uniformity is what AI classifiers flag.
- **Persona rotation.** Three canonical personas (Jake Morrison — Southeast termite specialist; Maria Chen — Pacific Northwest IPM expert; Carlos Reyes — Southwest veteran). Temperature 0.85–1.0, `top_p` 0.9, explicit style directives (contractions, em-dashes, mixed sentence length, contrarian opinions, named product recommendations).
- **Banned phrase auto-reject.** `"it is important to note"`, `"it is worth mentioning"`, `"in conclusion"`, `"when it comes to"`, `"at the end of the day"`, `"navigating the world of"`, `"a testament to"`, `"dive into"`, `"in today's fast-paced world"`, `"furthermore"`, `"moreover"`, `"in summary"` — regenerated on detection.
- **Local data injection.** 8–12 unique local data points per article (climate, pest DB, Census).
- **Output.** Markdown committed to the same `hugo-site/` repo; Netlify auto-deploys.

### Agent 6 — Social Media Engagement Responder _(designed, not implemented)_
`PRD v7 §9`

Tiered responder for comments, mentions, and DMs.

| Tier | Trigger | Response | Escalation |
|---|---|---|---|
| 1 — Auto | Generic comments, simple FAQ, emoji reactions | Automated reply within 1 hour | None |
| 2 — Template + personalize | "How much does X cost?", location questions | Templated reply personalized to their city/pest | None |
| 3 — Human escalation | Complaints, negative reviews, pest emergencies | Flag for human review with draft | Queue for operator |
| 4 — Do not respond | Trolls, spam, competitor provocation, political | Ignore or hide | None |

- **Hard rules.** Never promise specific pricing / availability / service quality. Never claim to be a pest control company — position as "a service that connects homeowners with trusted local professionals." Never engage hostility publicly. All auto-responses vary phrasing to feel human. Latency target: <2h for Tier 1–2, <24h for Tier 3 after review.

### Agent 7 — Performance Monitor
`src/agents/agent-7-monitor/`

Pulls metrics via a `DataProvider` interface (Mock, DatabaseBacked, or SearchConsole). Writes `performance_snapshots` and `ranking_snapshots`, computes a portfolio health score, evaluates thresholds, inserts `alerts`, writes `optimization_actions`, and — the V9 closed-loop change — inserts deduplicated follow-up rows into `agent_tasks` so the orchestrator can dispatch remediation (`content_refresh`, `cta_optimization`, `keyword_refinement`).

### Agent 8 — Backlink & Citation Builder _(designed, not implemented)_
`PRD v7 §11`

White-hat authority building. Because `extermanation.com` uses subdirectory architecture (`/city/`, `/city/service/`), every backlink strengthens the root domain — but a single penalty would deindex every city page simultaneously, so only white-hat tactics are acceptable.

- **Citation pipeline (bootstrap tier, $0).** NAP consistency across every listing (one canonical name / address / phone matching website footer + schema markup). Free aggregator submissions: Express Update (feeds Yellow Pages, Superpages, CitySearch, 100+ directories), Foursquare Business (feeds Apple Maps, Uber), Google Business Profile. Free major directory claims: Yelp, Bing Places, Apple Business Connect, Facebook Business, Nextdoor, LinkedIn, Angi, Thumbtack, Manta, Hotfrog, MapQuest.
- **Industry directories (pest).** NPMA Find-A-Pro (PestWorld.org, requires membership + QualityPro cert), state pest control associations (CPCA, AzPPO, etc.).
- **Targets.** 25–30 quality citations per city at $0 cost, completed within 2–3 weeks of city deployment. 2–4 operator hours per city for manual submissions.
- **Link building (next tier).** HARO responses, guest post pitches, broken-link outreach, resource page placement — all white-hat, all deduped against a `link_targets` table to avoid re-pitching the same domain.

### Agent 9 — Google Ads Manager _(designed, Phase 2, not implemented)_
`PRD v7 §12`

Paid acquisition that runs in parallel with organic. Organic takes 3–6 months to materialize; Agent 9 delivers calls immediately while the portfolio ramps.

- **Campaign shape.** Call-Only Ads + call extensions (bypasses landing page entirely for maximum call conversion). Search campaigns driving to dedicated PPC landing pages (Archetype 4: Minimalist PPC Machine).
- **Bid strategy.** Target CPA = `payout × 0.4` to maintain 60% margin. Bids sourced directly from Agent 0's `bid_maps`.
- **Controls.** Negative keyword lists to exclude DIY / jobs / informational intent. Dayparting: concentrate budget 7am–7pm local. Geo-targeting at ZIP level to match MarketCall's payout zones.
- **Budget.** Start $10–20/day per city. Scale on positive-ROI markets. Pause when CPA > 50% of avg payout. Seasonal reallocation (termite in spring, rodents in fall).
- **Feedback to organic.** Paid is a proving ground: if a city converts on paid, Agent 1 upweights it for organic. PPC conversion data directly informs A/B tests on organic pages in Agent 3.

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

Consolidated from `CallForge PRD v7.docx` (original 10-agent design), V9 `§ 25.8` (remaining gaps after V9), `designdecisions.md`, and the gap plans.

**Unbuilt agents (designed in PRD v7, tracked here in priority order):**

- [ ] **Agent 0 — Network Intelligence.** MarketCall postback receiver + auth'd Playwright catalog scraper + Ringba REST client. Unlocks payout-aware scoring across the whole portfolio.
- [ ] **Agent 8 — Backlink & Citation Builder.** NAP pipeline + free aggregator submissions + industry directories. Without backlinks, pages will not rank.
- [ ] **Agent 5 — Blog Content Engine.** Section-by-section persona-rotated blog generation with AI-detector defenses.
- [ ] **Agent 4 — Social Media Content Engine.** COPE engine across 6 platforms (downstream of Agent 5).
- [ ] **Agent 6 — Social Media Engagement Responder.** Tiered responder with hard guardrails.
- [ ] **Agent 9 — Google Ads Manager (Phase 2).** Call-Only Ads with bids sourced from Agent 0.

**Platform upgrades (V9 §25.8 + gap plans + designdecisions.md):**

- [ ] Market Scanner — full Census/CBSA/NOAA/HUD/Frostline/Moz feed into Agent 0.5
- [ ] Database-backed opportunity queue (replaces hardcoded `CANDIDATE_CITIES`)
- [ ] Two-pipeline (`standalone_city` + `suburb`) scoring + ranking in Agent 0.5
- [ ] Release layer separated from content creation (scheduled publication windows)
- [ ] Payout-aware expected-value scoring across Agents 0.5 + 1 (requires Agent 0)
- [ ] Cache source versioning (estimated vs. Google Ads API) in Agent 1
- [ ] Real Agent 7 data providers (GSC + GA4 + MarketCall) replacing mocks
- [ ] Indexation kill switch driven by Search Console / URL Inspection
- [ ] Stronger uniqueness gate using structured local facts + similarity scoring
- [ ] Full pest-control playbook compliance in Agent 3 (all 40 gap-plan items)
- [ ] Per-vertical prompt stacks for HVAC and roofing (today they fall back to default)
- [ ] Dashboard UI for authoring vertical / offer profiles
- [ ] Compliance QA that hard-fails on exact banned service tokens
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

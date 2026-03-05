# Agent 1 Deep Research Refactor — Design Document

**Date:** 2026-03-05
**Status:** Approved
**Approach:** Hybrid — Parallel Research Subagents + Playbook Synthesis (Approach C)

---

## Goal

Refactor Agent 1 (Keyword Research) to produce two things in sequence:

1. A **human-readable market selection playbook document** (`playbook.md`) comparable in depth and quality to a comprehensive Claude Chat research output (3,000–6,000 words, 100+ sources cited).
2. The **same DB output schema** as today (`city_keyword_map`, `keyword_clusters`) — now grounded in real research data instead of hallucinated from training.

Downstream agents (Agent 2, Agent 3) are unaffected. No DB schema changes.

---

## Context

Agent 1 currently makes 3 LLM calls that hallucinate from training data:

- `KEYWORD_TEMPLATE_PROMPT` — generates keyword patterns with no real search data
- `CITY_SCORING_PROMPT` — scores cities with no real market or climate data
- `KEYWORD_CLUSTERING_PROMPT` — clusters keywords with no real intent or competitor data

Agent 2 already solved this problem for its domain using the Claude Agent SDK: `query()` spawns parallel Sonnet subagents with WebSearch + WebFetch + Write tools. Each writes findings to `tmp/agent2-research/{runId}/*.md`. Synthesis reads those files as context.

Agent 1 mirrors this pattern with a broader subagent scope (6 vs Agent 2's 6) and adds a dedicated playbook synthesis step before the 3 augmented LLM calls.

---

## Architecture & Data Flow

```
runAgent1(niche, cities)
│
├── PHASE 1: Parallel Research (~8–12 min)
│   └── query() via Agent SDK → Opus orchestrator
│       Spawns 6 Sonnet subagents in parallel:
│       ├── keyword-pattern-researcher    → tmp/agent1-research/{runId}/keyword-patterns.md
│       ├── market-data-researcher        → tmp/agent1-research/{runId}/market-data.md
│       ├── competitor-keyword-researcher → tmp/agent1-research/{runId}/competitor-keywords.md
│       ├── local-seo-researcher          → tmp/agent1-research/{runId}/local-seo.md
│       ├── ppc-economics-researcher      → tmp/agent1-research/{runId}/ppc-economics.md
│       └── gbp-competition-researcher   → tmp/agent1-research/{runId}/gbp-competition.md
│
├── PHASE 2a: Playbook Synthesis (~2 min)
│   └── llm.call(Sonnet) reads all 6 research files
│       Writes → tmp/agent1-research/{runId}/playbook.md
│       Also copies → docs/playbooks/{niche}/{runId}-playbook.md  (permanent)
│
├── PHASE 2b: Keyword Templates (augmented — replaces Step 1)
│   └── llm.call(Haiku)
│       Context: playbook.md + keyword-patterns.md + competitor-keywords.md
│       Output: 20-30 keyword templates (same schema as today)
│
├── PHASE 2c: City Scoring (augmented — replaces Step 4)
│   └── llm.call(Haiku) per batch
│       Context: playbook.md + market-data.md + gbp-competition.md + ppc-economics.md
│       Output: city scores 0-100 (same schema as today)
│
├── PHASE 2d: Keyword Clustering (augmented — replaces Step 5)
│   └── llm.call(Haiku) per city
│       Context: playbook.md + keyword-patterns.md + competitor-keywords.md + local-seo.md
│       Output: keyword clusters (same schema as today)
│
└── PHASE 3: DB Writes (unchanged)
    └── city_keyword_map + keyword_clusters
        Same output schema. No downstream breaking changes.
```

The playbook is saved to `docs/playbooks/{niche}/{runId}-playbook.md` permanently — it's the human-reviewable artifact for evaluating run quality.

---

## The 6 Research Subagents

### 1. keyword-pattern-researcher
**Researches:** Real search terms pest control customers use — SERP analysis of top-ranking pest control pages, Google Autocomplete patterns, "people also ask" aggregates, SEMrush/Ahrefs blog posts on pest control SEO, intent classification data, local service keyword research case studies.

**Target output:** 60+ real keyword patterns with search intent classification (emergency / prevention / inspection / treatment) and estimated monthly volume ranges.

**Writes to:** `keyword-patterns.md`

**Feeds:** KEYWORD_TEMPLATE_PROMPT (Phase 2b), KEYWORD_CLUSTERING_PROMPT (Phase 2d)

---

### 2. market-data-researcher
**Researches:** Census demographic data sources, NOAA climate data (temperature/precipitation), HUD Termite Infestation Probability zones, Frostline USDA Hardiness Zone dataset, NPMA industry reports on pest pressure by US region, Google Trends pest control interest by state.

**Target output:** Data covering 4 US climate regions (Southeast, Southwest, Northeast, Midwest) with city-level pest pressure signals. Includes the scoring model (temperature, precipitation, TIP zone, hardiness zone → 0–100 composite).

**Writes to:** `market-data.md`

**Feeds:** CITY_SCORING_PROMPT (Phase 2c)

---

### 3. competitor-keyword-researcher
**Researches:** Real rank-and-rent and lead-gen pest control sites — URL slug patterns, keyword→URL mappings, title tag conventions, which keyword structures drive rankings for high-DA sites, keyword clustering patterns used by top-performing affiliate/lead-gen sites.

**Target output:** 50+ real competitor URL patterns with keyword intent mapping. Identifies which slug formats appear most frequently for high-ranking non-franchise pest control sites.

**Writes to:** `competitor-keywords.md`

**Feeds:** KEYWORD_TEMPLATE_PROMPT (Phase 2b), KEYWORD_CLUSTERING_PROMPT (Phase 2d)

---

### 4. local-seo-researcher
**Researches:** Local SEO ranking factors for service businesses without a Google Business Profile (rank-and-rent model specifically). City page optimization case studies, "city + service" keyword difficulty benchmarks, NAP citation research for non-GBP sites, local pack exclusion strategies, Whitespark Local Search Ranking Factors findings.

**Target output:** 40+ data points on ranking factors specific to the rank-and-rent model. Weighted factor breakdown (GBP signals, reviews, on-page, links, behavioral).

**Writes to:** `local-seo.md`

**Feeds:** KEYWORD_CLUSTERING_PROMPT (Phase 2d)

---

### 5. ppc-economics-researcher ← NEW
**Researches:** Pay-per-call network rates for pest control (Marketcall, Soleo, ResultCalls, Service Direct), CPL benchmarks by market type (suburb vs. small city vs. medium city), call conversion rates, average job values by pest control niche, customer lifetime value data, pest control company willingness to pay for leads, rank-and-rent site economics by market size.

**Target output:** Pay-per-call rate ranges by niche ($20–$80 general, $100–$300 specialty), CPL benchmarks, expected revenue by market type, ROI thresholds for lead buyers.

**Writes to:** `ppc-economics.md`

**Feeds:** CITY_SCORING_PROMPT (Phase 2c) — monetization signals for city scoring

---

### 6. gbp-competition-researcher ← NEW
**Researches:** GBP density patterns by city size, Map Pack saturation signals, franchise presence data (Orkin, Terminix/Rentokil, Aptive location counts), review distribution patterns that signal locked vs. open markets, Google's lead gen GBP prohibition enforcement, LSA (Local Service Ads) presence patterns.

**Target output:** Competition scoring thresholds — GBP count ranges by market type, review count cutoffs, franchise count signals (0–1 = open, 2–3 = monetizable, 4+ = saturated), single-dominant-operator detection criteria.

**Writes to:** `gbp-competition.md`

**Feeds:** CITY_SCORING_PROMPT (Phase 2c), KEYWORD_CLUSTERING_PROMPT (Phase 2d)

---

## LLM Interface Contract

### Research file format (mandatory — all 6 subagents)

```markdown
# [Domain] Research — {niche}
**Subagent:** [subagent-name]
**Sources consulted:** [N]
**Date:** [ISO date]

## Key Findings

### [Finding Title]
**Evidence:** [URL or named study]
**Data:** [specific numbers, percentages, dollar amounts]
**Implication:** [what this means for market selection / keyword strategy]

[Repeat for all major findings]

## Source Index
- [URL] — [one-line description]
```

Minimum requirements (enforced by research-reader.ts validation):
- `## Key Findings` section present
- `## Source Index` section present with ≥5 entries
- `**Sources consulted:**` count ≥5
- File word count ≥300

### Playbook document format (Phase 2a output)

```markdown
# [Niche] Market Selection Playbook
**Generated:** [ISO date] | **Run ID:** [runId] | **Sources consulted:** [N total across all subagents]

## Executive Summary
[3–5 bullet points: top findings, key thresholds, recommended market tier]

## Market Sizing & Economics
## Two-Pipeline Candidate Logic
### Pipeline A: Standalone Cities (50K–300K)
### Pipeline B: Suburbs (25K–100K in 500K+ metros)
## Climate & Pest Pressure Scoring
## Competition Scoring Model
## Keyword Patterns & Intent Classification
## Competitor URL Patterns
## Pay-Per-Call Economics
## Red Flags: Auto-Disqualify Signals
## Free Tool Stack
## Source Index
```

Length target: 3,000–6,000 words. All sections must cite evidence from the 6 research files. No invented data.

---

## Playbook Storage

Two locations:
- **Ephemeral:** `tmp/agent1-research/{runId}/playbook.md` — for Phase 2b/2c/2d to read as context
- **Permanent:** `docs/playbooks/{niche}/{runId}-playbook.md` — for human review and run comparison

The `tmp/` copy is used by the synthesis LLM calls. The `docs/playbooks/` copy is the reviewable artifact.

---

## Error Handling

- If 1–2 subagents fail: Phase 2 proceeds with available files, logs which were missing
- If <4 valid research files: abort Phase 2 and surface error (insufficient research to synthesize a reliable playbook)
- If playbook synthesis fails: abort Phase 2b/2c/2d (no fallback to hallucinated output — fail loudly)
- Research reader validates each file against the LLM interface contract before Phase 2 begins

---

## Testing Plan

1. **Unit tests — research-reader-a1.ts:** Validates each of the 6 file formats (mandatory sections, source count, word count)
2. **Unit tests — subagent-prompts.ts:** Each prompt produces required markdown sections
3. **Integration test:** Phase 1 with real niche → verify all 6 files exist and pass validation, playbook.md written
4. **Comparison report:** Run Agent 1 twice (without research / with research) → `docs/agent1-research-comparison.md`

---

## Implementation Tasks (7)

Mirrors `agent1-research-plan-prompt.md` task structure:

1. Verify Agent SDK installed (check package.json, confirm `query()` API)
2. Create `src/agents/agent-1-keywords/research-reader.ts` (extend or reuse Agent 2's, add 6-file validation)
3. Create `src/agents/agent-1-keywords/subagent-prompts.ts` (6 subagent prompt builders)
4. Create `src/agents/agent-1-keywords/research-orchestrator.ts` (wraps Agent SDK `query()` call)
5. Update `src/agents/agent-1-keywords/prompts.ts` (augment KEYWORD_TEMPLATE, CITY_SCORING, KEYWORD_CLUSTERING to accept research context)
6. Wire Phase 1 into `runAgent1()` in `src/agents/agent-1-keywords/index.ts` (research before synthesis)
7. Run comparison report and produce `docs/agent1-research-comparison.md`

---

## Success Criteria

- Agent 1 run produces a `docs/playbooks/{niche}/{runId}-playbook.md` that is comparable in depth to the manually-generated `agent1playbookplan.md` (3,000+ words, 100+ sources, full decision framework)
- All existing DB outputs (`city_keyword_map`, `keyword_clusters`) still produced with same schema
- Keyword templates reference real patterns (not generic `{city} pest control` hallucinations)
- City scores reference real market data (climate zones, population data, competition signals)
- Keyword clusters reference real intent data (competitor URL patterns, local SEO factors)

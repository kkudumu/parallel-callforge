# Agent 2 Deep Research Rebuild — Design Document

**Date:** 2026-03-05
**Status:** Approved
**Scope:** Redesign Agent 2 (design research) to produce output matching Claude.ai Research quality

---

## Problem

Agent 2 currently makes 5 sequential single-shot `llm.call()` calls with no web access. Every output — competitor analysis, design specs, copy frameworks, schema templates, seasonal calendars — is hallucinated from LLM training data. No real competitor sites are visited. No real CRO studies are cited.

### Gap vs Claude.ai Research output

| Element | Claude.ai Research | Agent 2 today |
|---|---|---|
| Source citations | 20+ real studies (Unbounce 57M, WordStream 16K, Invoca, HubSpot) | Zero |
| Competitor analysis | 12 real sites with URLs, ratings, specific findings | Fabricated patterns |
| CVR data per archetype | Yes — 15–30%, 4–8%, etc. with evidence | None |
| CSS specifications | Production-ready code | None |
| Evidence-based copy | A/B test data with % lifts per formula | Generic templates |
| Implementation priorities | 3 tiers ranked by proven conversion impact | None |
| Output depth | ~8,000 word research document | ~200 tokens of schema JSON |

**Similarity score: ~15%.** The schemas overlap structurally (archetypes, colors, copy, schema, seasonal) but Agent 2 has no real data behind any of it.

---

## Approach Decision: B — Orchestrator + Native Agent SDK Subagents

Three approaches were evaluated:

**A — Single deep-research session:** Add `--allowedTools WebSearch,Fetch` to existing claude call, change prompts. Minimal code change but hits context window limits around 40–60 URLs. Cannot reach 600 sources in a single session.

**C — Manual parallel subprocess spawning:** Spawn multiple `claude` CLI subprocesses via `Promise.all()`, each writing findings to temp files, orchestrator synthesizes. More code, manual subprocess/stream management, orchestrator is blind to subagent results until they complete — cannot adapt mid-research.

**B — Agent SDK native subagents (chosen):**
- Uses `@anthropic-ai/claude-agent-sdk`'s `query()` function
- Orchestrator spawns subagents via the native `Task` tool — SDK handles parallelization
- Orchestrator is **intelligent**: reads subagent results as they return, can adapt strategy dynamically (e.g. "competitor-analyzer found Orkin uses sticky bars — direct copy-researcher to focus on sticky bar copy data")
- SDK has built-in session resumability — 200-turn research sessions can resume if interrupted
- WebSearch + WebFetch are first-class named tools, free, built into Claude Code
- Subagents have isolated context windows — no pollution of main orchestrator context

**B is the approach described in Anthropic's "How we built our multi-agent research system" post.** Approach C is a manual reimplementation of what B does natively.

### Key SDK constraint

Subagents **cannot** spawn their own subagents. The `Task` tool must not appear in subagent tool lists. Architecture must be flat: orchestrator → subagents (one level only).

---

## Architecture

```
runAgent2(niche, offerProfile)
  │
  ├─ Phase 1: RESEARCH  (Agent SDK query())
  │    Orchestrator [claude-opus-4, max_turns=200]
  │    Tools: Task, Write, Read
  │    Prompt instructs: start wide then narrow, search breadth-first,
  │                      adapt based on what subagents return
  │    │
  │    ├─→ competitor-analyzer   [sonnet, WebSearch + WebFetch + Write]
  │    │     Search top pest control sites in 8+ US markets (Houston,
  │    │     Phoenix, Atlanta, Dallas, Tampa, Miami, Chicago, Denver)
  │    │     Visit each page: extract layout, CTA placement, trust signals,
  │    │     copy patterns, mobile behavior, schema usage
  │    │     Target: ~100 pages
  │    │     Output: tmp/agent2-research/{runId}/competitors.md
  │    │
  │    ├─→ cro-researcher        [sonnet, WebSearch + WebFetch + Write]
  │    │     Find: Unbounce benchmark reports, WordStream campaign data,
  │    │     Invoca phone lead benchmarks, HubSpot CTA studies,
  │    │     A/B test results for local service landing pages,
  │    │     CVR benchmarks per page type and traffic source
  │    │     Target: ~100 sources
  │    │     Output: tmp/agent2-research/{runId}/cro-data.md
  │    │
  │    ├─→ design-researcher     [sonnet, WebSearch + WebFetch + Write]
  │    │     Color psychology for home services businesses,
  │    │     layout grid CRO data, typography sizing research,
  │    │     mobile UX benchmarks, Core Web Vitals impact on CVR,
  │    │     button design A/B tests, sticky element performance data
  │    │     Target: ~100 sources
  │    │     Output: tmp/agent2-research/{runId}/design.md
  │    │
  │    ├─→ copy-researcher       [sonnet, WebSearch + WebFetch + Write]
  │    │     Headline formula performance data (loss aversion vs gain),
  │    │     CTA copy A/B tests (first-person vs second-person),
  │    │     reading level impact on CVR, PAS script examples,
  │    │     guarantee copy patterns, microcopy below CTAs,
  │    │     pest-control-specific headline examples
  │    │     Target: ~100 sources
  │    │     Output: tmp/agent2-research/{runId}/copy.md
  │    │
  │    ├─→ schema-researcher     [sonnet, WebSearch + WebFetch + Write]
  │    │     JSON-LD for local service businesses without GBP,
  │    │     PestControlService schema.org type usage,
  │    │     areaServed vs address for rank-and-rent,
  │    │     FAQPage and Review schema requirements and penalties,
  │    │     call tracking + DNI implementation for schema telephone
  │    │     Target: ~50 sources
  │    │     Output: tmp/agent2-research/{runId}/schema.md
  │    │
  │    └─→ seasonal-researcher   [sonnet, WebSearch + WebFetch + Write]
  │          Real pest activity data by month and region (NPMA reports,
  │          university extension data, Google Trends pest seasonality),
  │          marketing spend allocation benchmarks by month,
  │          regional pest pressure maps, pest peak timing by climate zone
  │          Target: ~50 sources
  │          Output: tmp/agent2-research/{runId}/seasonal.md
  │
  │    Total: ~500–600 sources across 6 parallel subagents
  │
  └─ Phase 2: SYNTHESIS  (existing llm.call() × 5)
       Reads all tmp/agent2-research/{runId}/*.md files
       Passes combined research as context to existing synthesis calls
       Produces existing DB schema outputs — NO schema changes:
         → competitor_analyses  (CompetitorAnalysisSchema)
         → design_specs         (DesignSpecSchema)
         → copy_frameworks      (CopyFrameworkSchema)
         → schema_templates     (SchemaTemplateSchema)
         → seasonal_calendars   (SeasonalCalendarSchema)
       Cleans up tmp/agent2-research/{runId}/ after successful write
```

---

## Orchestrator Prompt Principles

Drawn from Anthropic's published multi-agent research principles:

1. **Start wide, then narrow** — Orchestrator instructs each subagent to begin with short broad queries, evaluate what exists, then drill into specifics. Prevents agents defaulting to overly specific queries that return few results.

2. **Explicit task boundaries** — Each subagent gets a clear objective, output format, specific sources to prioritize, and what NOT to overlap with other subagents (e.g. "competitor-analyzer finds competitor CTAs; copy-researcher finds CRO studies about CTA copy — don't duplicate").

3. **Scale effort to complexity** — Competitor analysis and CRO research get more turns and sources than schema research (which has fewer sources to find).

4. **Adapt based on findings** — Orchestrator reads each subagent's output file and can spawn follow-up research if gaps are found before proceeding to synthesis.

5. **Save plan to memory early** — If orchestrator context approaches limits, it saves its research plan and state before compaction occurs.

---

## Tools

| Tool | Cost | Source | Used by |
|---|---|---|---|
| `WebSearch` | Free | Built into Claude Code | All 6 subagents |
| `WebFetch` | Free | Built into Claude Code | All 6 subagents |
| `Write` | Free | Built into Claude Code | All 6 subagents (findings to files) |
| `Read` | Free | Built into Claude Code | Orchestrator (reads findings files) |
| `Task` | Free | Agent SDK native | Orchestrator (spawns subagents) |

No paid APIs required. No new MCP servers to install.

---

## What Changes

| Component | Change |
|---|---|
| `package.json` | Add `@anthropic-ai/claude-agent-sdk` |
| `src/agents/agent-2-design/index.ts` | Add Phase 1 research before existing Phase 2 synthesis calls |
| `src/agents/agent-2-design/research-orchestrator.ts` | New file — `query()` call with 6 subagent definitions |
| `src/agents/agent-2-design/subagent-prompts.ts` | New file — detailed prompts for each of the 6 research subagents |

## What Stays the Same

| Component | Status |
|---|---|
| All 5 DB schemas (`CompetitorAnalysisSchema`, `DesignSpecSchema`, etc.) | Unchanged |
| All DB write logic | Unchanged |
| All checkpoint/self-healing logic | Unchanged |
| `llm.call()` for synthesis phase | Unchanged — just gets richer input |
| Agent 2 config interface (`Agent2Config`) | Unchanged |
| Downstream agents (Agent 3, Agent 7) | Unchanged |

---

## Quality Target

Output must be ≥90% similar in depth and evidence quality to Claude.ai Research output for the same prompt. Evaluation criteria:

- Real competitor site URLs cited (not fabricated)
- CVR percentages backed by named studies
- CSS/code specifications included in design spec
- Copy formulas tagged with evidence (A/B tested vs best practice)
- Schema templates are complete and valid JSON-LD
- Seasonal calendar cites real pest activity data sources

---

## Run Time Expectation

| Phase | Duration |
|---|---|
| Phase 1 Research (parallel) | 15–25 min (subagents run in parallel, longest one determines total) |
| Phase 2 Synthesis (sequential) | 3–5 min (same as today) |
| **Total** | **~20–30 min vs ~3 min today** |

This is acceptable given Agent 2 runs once per niche and results are cached with a TTL. A niche like "pest control" runs Agent 2 once, then reuses cached output for all cities.

---

## Next Step

Invoke `superpowers:writing-plans` to create the implementation plan.

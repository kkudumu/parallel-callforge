# Prompt: Plan Agent 1 Deep Research Rebuild

Use this prompt in a fresh planning session (e.g. /gsd:plan-phase or /plan).

---

You are designing a deep research upgrade for **Agent 1 (Keywords)** in the
`parallel-callforge` codebase, mirroring the pattern just built for Agent 2.

## Context: What Agent 2 did (the reference implementation)

Read these files to understand the pattern before designing Agent 1's version:

- `docs/plans/2026-03-05-agent2-deep-research-impl.md` — the full plan
- `src/agents/agent-2-design/research-reader.ts` — file reader + validator
- `src/agents/agent-2-design/research-orchestrator.ts` — Agent SDK query() call
- `src/agents/agent-2-design/subagent-prompts.ts` — 6 subagent prompt builders
- `src/agents/agent-2-design/prompts.ts` — synthesis prompts that accept research context
- `src/agents/agent-2-design/index.ts` — Phase 1 (research) wired before Phase 2 (synthesis)

The pattern is:
1. **Phase 1**: `query()` spawns N subagents in parallel via Agent SDK. Each
   subagent uses WebSearch + WebFetch + Write to browse real sources and write
   findings to `tmp/agent1-research/{runId}/*.md` in a mandatory format.
2. **Phase 2**: existing `llm.call()` synthesis reads those files as context
   and produces the same DB output schemas as today.

The LLM interface contract (mandatory file format subagents must write):
```
# [Domain] Research — {niche}
**Subagent:** [name]
**Sources consulted:** [N]
**Date:** [ISO date]
## Key Findings
### [Finding Title]
**Evidence:** [URL or named study]
**Data:** [specific numbers]
**Implication:** [what this means]
## Source Index
- [URL] — [one-line description]
```

## Context: What Agent 1 currently does

Read these files:
- `src/agents/agent-1-keywords/prompts.ts` — 3 prompts: KEYWORD_TEMPLATE_PROMPT,
  CITY_SCORING_PROMPT, KEYWORD_CLUSTERING_PROMPT
- `src/agents/agent-1-keywords/index.ts` — runAgent1() with 6 steps:
  Step 1: keyword templates (1 llm.call)
  Step 2: expand templates per city
  Step 3: fetch Google Autocomplete + Trends metrics
  Step 4: score cities via LLM (1 llm.call per batch)
  Step 5: cluster keywords per city (1 llm.call per city)
  Step 6: write to DB

The 3 LLM calls that currently hallucinate and would benefit from real research:
- **Keyword templates**: generates keyword patterns from thin air — no data on
  what search terms people actually use for pest control in different markets
- **City scoring**: scores cities based on generic heuristics — no real data
  on pest pressure by region, market competition density, or CPL benchmarks
- **Keyword clustering**: clusters keywords with no knowledge of actual search
  intent patterns, SERP features, or competitor keyword gaps

## Your task

Design a complete implementation plan (following the exact same structure as
`docs/plans/2026-03-05-agent2-deep-research-impl.md`) for adding a Phase 1
deep research layer to Agent 1.

### Required subagents to design

Design prompts for these 4 research subagents (Agent 1 needs fewer than
Agent 2's 6 because keyword research is more focused):

1. **keyword-pattern-researcher** — finds real keyword patterns that pest
   control customers actually search. Searches Google Keyword Planner data,
   SEMrush/Ahrefs blog posts on pest control SEO, actual SERP analysis of
   top-ranking pest control pages, "people also search for" patterns, and
   local service keyword research case studies. Target: 60+ real keyword
   patterns with search intent classification and estimated volume ranges.

2. **market-data-researcher** — finds real data on pest control market
   characteristics by US region/climate zone. Searches NPMA industry reports,
   pest pressure indexes, Google Trends data for pest-related searches by
   state, PPM (pest-per-mile) data, and home services market sizing reports.
   Target: data covering all 4 US climate regions (Southeast, Southwest,
   Northeast, Midwest) with city-level signals where available.

3. **competitor-keyword-researcher** — analyzes what keywords and URL
   structures the top-ranking rank-and-rent pest control sites actually use.
   Searches for real pest control affiliate/lead-gen sites, extracts their
   URL slug patterns, identifies which keyword → URL mappings drive rankings,
   and finds keyword clustering patterns used by high-authority sites. Target:
   50+ real competitor URL patterns with keyword intent mapping.

4. **local-seo-researcher** — finds real data on local SEO ranking factors
   for service businesses without a GBP (rank-and-rent model). Searches for
   city page optimization case studies, "city + service" keyword difficulty
   benchmarks, NAP citation research for non-GBP sites, and local pack
   exclusion strategies. Target: 40+ data points on ranking factors specific
   to the rank-and-rent model.

### Research output files

Each subagent writes to `tmp/agent1-research/{runId}/`:
- `keyword-patterns.md`
- `market-data.md`
- `competitor-keywords.md`
- `local-seo.md`

### Synthesis integration

The plan must specify exactly how each research file gets injected into each
of the 3 existing LLM calls:
- `keyword-patterns.md` + `competitor-keywords.md` → KEYWORD_TEMPLATE_PROMPT
- `market-data.md` + `local-seo.md` → CITY_SCORING_PROMPT
- `keyword-patterns.md` + `competitor-keywords.md` + `local-seo.md` → KEYWORD_CLUSTERING_PROMPT

### Quality comparison deliverable

The plan MUST include a **Task: Comparison Report** as the final task. This
task asks the implementer to run Agent 1 TWICE — once without research context
and once with — and produce a markdown report at
`docs/agent1-research-comparison.md` containing:

```markdown
# Agent 1 Research Phase: Before/After Comparison

## Run metadata
- Niche: [niche used]
- Date: [ISO date]
- Without research: [run timestamp]
- With research: [run timestamp]

## Research phase stats (with research)
| Subagent | Sources consulted | File word count | Valid? |
|---|---|---|---|
| keyword-pattern-researcher | N | N | yes/no |
| market-data-researcher | N | N | yes/no |
| competitor-keyword-researcher | N | N | yes/no |
| local-seo-researcher | N | N | yes/no |
| **Total** | **N** | **N** | |

## Keyword template quality
| Metric | Without research | With research |
|---|---|---|
| Template count | N | N |
| Templates citing real search data | 0 | N |
| Templates with intent classification | N | N |
| Novel patterns not in baseline | — | N |

## City scoring quality
| Metric | Without research | With research |
|---|---|---|
| Cities scored | N | N |
| Scores citing real market data | 0 | N |
| Regional variance (std dev of scores) | N | N |
| Scores with pest pressure signal | 0 | N |

## Keyword clustering quality
| Metric | Without research | With research |
|---|---|---|
| Clusters generated (sample city) | N | N |
| Clusters citing real intent data | 0 | N |
| Unique secondary keywords per cluster | N | N |

## Qualitative assessment
[2-3 paragraph comparison of output quality differences]

## Verdict
[Did research phase improve output quality? By how much? Worth the runtime cost?]
```

## Plan structure requirements

Follow the exact task numbering, step format, TDD pattern, and commit
convention from the Agent 2 plan. Include:
- LLM interface contract section (same format as Agent 2's plan)
- Task 1: Install/verify SDK (already installed — just verify)
- Task 2: Create research-reader equivalent (can reuse Agent 2's if identical
  contract, or extend it)
- Task 3: Create subagent-prompts.ts for Agent 1's 4 subagents
- Task 4: Create research-orchestrator.ts for Agent 1
- Task 5: Update Agent 1's 3 prompts to accept research context
- Task 6: Wire Phase 1 into runAgent1()
- Task 7: Comparison report run

Save the plan to: `docs/plans/2026-03-05-agent1-deep-research-impl.md`

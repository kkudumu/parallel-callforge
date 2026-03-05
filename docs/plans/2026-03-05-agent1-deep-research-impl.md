# Agent 1 Deep Research Rebuild — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a two-phase research system to Agent 1: Phase 1 spawns 6 parallel research subagents via the Claude Agent SDK that browse real web sources and write findings to markdown files; Phase 2a synthesizes those findings into a human-readable market selection playbook; Phase 2b–2d feeds the playbook as context into the 3 existing LLM calls (keyword templates, city scoring, clustering), grounding them in real data instead of hallucinations.

**Architecture:** Agent SDK `query()` runs an orchestrator that spawns 6 Sonnet subagents in parallel. Each writes findings to `tmp/agent1-research/{runId}/*.md` in a mandatory format. Phase 2a runs `llm.call(Sonnet)` to synthesize all 6 files into `playbook.md` (saved permanently to `docs/playbooks/{niche}/`). The 3 existing `llm.call(Haiku)` synthesis calls receive playbook context prepended, output schemas unchanged.

**Tech Stack:** TypeScript ESM, `@anthropic-ai/claude-agent-sdk` (already installed by Agent 2), Claude Code built-in `WebSearch`/`WebFetch`/`Write`, existing Zod schemas, existing `llm.call()`.

**Design doc:** `docs/plans/2026-03-05-agent1-deep-research-design.md`

---

## LLM Interface Contracts

### Contract A: Research subagent output files (LLM writes → code reads)

Subagents write markdown files. `research-reader.ts` validates them before Phase 2 runs.

```markdown
# [Domain] Research — {niche}

**Subagent:** [subagent-name]
**Sources consulted:** [N]
**Date:** [ISO date]

## Key Findings

### [Finding Title]
**Evidence:** [Source URL or named study]
**Data:** [Specific numbers, percentages, dollar amounts]
**Implication:** [What this means for keyword strategy / market selection]

[Repeat for each major finding — aim for 15-25 findings]

## Source Index
- [URL] — [one-line description]
[All sources visited, one per line]
```

**Enforcement:** `validateResearchFile()` rejects any file missing `## Key Findings`, `## Source Index`, finding blocks with all 3 fields, or under 500 words. Files failing validation are skipped (Phase 2 proceeds with valid files only; aborts if < 4 valid).

**Model:** Sonnet (complex multi-source research task).

**Must NOT:** Use different section names, omit Source Index, write findings without Evidence/Data/Implication triple.

---

### Contract B: Playbook synthesis output (LLM reads 6 files → writes playbook.md)

Phase 2a synthesis reads all 6 research files and produces a single comprehensive document.

**Required sections** (code validates all are present):
```
# [Niche] Market Selection Playbook
## Executive Summary
## Market Sizing & Economics
## Two-Pipeline Candidate Logic
## Climate & Pest Pressure Scoring
## Competition Scoring Model
## Keyword Patterns & Intent Classification
## Competitor URL Patterns
## Pay-Per-Call Economics
## Red Flags: Auto-Disqualify Signals
## Free Tool Stack
## Source Index
```

**Enforcement:** `validatePlaybookFile()` checks for all required `##` sections.

**Model:** Sonnet (synthesizing 6 large documents into a coherent narrative requires strong reasoning).

**Must NOT:** Invent data not in the research files, omit the Source Index, use different section headers.

---

### Contract C: Augmented synthesis prompts (code reads playbook → passes context → LLM writes structured output)

The 3 existing prompt builders receive an optional `researchContext: string` parameter that is prepended to their prompt. The output JSON schema is **unchanged** — same Zod validators, same DB writes.

**Must NOT:** Change `KeywordTemplatesResponseSchema`, `CityScoringResponseSchema`, or `KeywordClusteringResponseSchema`. Research context is additive only.

**Model:** Haiku (same as today — the research context does the heavy lifting; Haiku executes the extraction).

**Enforcement:** Existing Zod `schema` validators in `llm.call()`.

---

## Task 1: Verify Agent SDK is installed

**Files:**
- Read: `package.json`

**Step 1: Check package.json**

```bash
grep claude-agent-sdk package.json
```

Expected output: a line containing `@anthropic-ai/claude-agent-sdk`.

**Step 2: Verify the import compiles**

```bash
echo 'import { query } from "@anthropic-ai/claude-agent-sdk"; console.log("ok");' > /tmp/sdk-check.mts && npx tsx /tmp/sdk-check.mts && rm /tmp/sdk-check.mts
```

Expected: prints `ok` with no errors.

If the SDK is missing, install it:

```bash
npm install @anthropic-ai/claude-agent-sdk
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(agent-1): verify agent sdk dependency"
```

---

## Task 2: Create research-reader for Agent 1

Agent 2's `research-reader.ts` validates the same format Agent 1 subagents will use. We re-export its functions and add a `validatePlaybookFile` check for Phase 2a output.

**Files:**
- Create: `src/agents/agent-1-keywords/research-reader.ts`
- Create: `src/agents/agent-1-keywords/research-reader.test.ts`

**Step 1: Write the failing tests**

Create `src/agents/agent-1-keywords/research-reader.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  validateResearchFile,
  validatePlaybookFile,
  buildResearchContext,
  RESEARCH_FILE_NAMES_A1,
} from "./research-reader.js";

const VALID_RESEARCH = `# Keyword Pattern Research — pest control

**Subagent:** keyword-pattern-researcher
**Sources consulted:** 42
**Date:** 2026-03-05

## Key Findings

### Real search term: wildlife removal urgent
**Evidence:** https://ahrefs.com/keywords/pest-control
**Data:** 1,200 monthly searches, $45 CPC, low KD
**Implication:** Wildlife removal terms have high intent and low competition compared to general pest control

## Source Index
- https://ahrefs.com/keywords/pest-control — keyword data for pest control vertical
`;

const VALID_PLAYBOOK = `# Pest Control Market Selection Playbook

**Generated:** 2026-03-05 | **Run ID:** test-run | **Sources consulted:** 200

## Executive Summary
- Market opportunity confirmed

## Market Sizing & Economics
Data here

## Two-Pipeline Candidate Logic
Data here

## Climate & Pest Pressure Scoring
Data here

## Competition Scoring Model
Data here

## Keyword Patterns & Intent Classification
Data here

## Competitor URL Patterns
Data here

## Pay-Per-Call Economics
Data here

## Red Flags: Auto-Disqualify Signals
Data here

## Free Tool Stack
Data here

## Source Index
- https://example.com — source
`;

describe("validateResearchFile", () => {
  it("accepts a valid research file", () => {
    expect(validateResearchFile(VALID_RESEARCH)).toBe(true);
  });

  it("rejects a file missing ## Key Findings", () => {
    const bad = VALID_RESEARCH.replace("## Key Findings", "## Results");
    expect(validateResearchFile(bad)).toBe(false);
  });

  it("rejects a file missing ## Source Index", () => {
    const bad = VALID_RESEARCH.replace("## Source Index", "## References");
    expect(validateResearchFile(bad)).toBe(false);
  });

  it("rejects a file with no finding blocks", () => {
    const bad = VALID_RESEARCH.replace(
      /### Real.*\n[\s\S]*?low competition compared to general pest control/,
      "### Finding without structure\nJust prose."
    );
    expect(validateResearchFile(bad)).toBe(false);
  });

  it("rejects a file under 500 words", () => {
    expect(validateResearchFile("# Short\n## Key Findings\n## Source Index\n- x")).toBe(false);
  });
});

describe("validatePlaybookFile", () => {
  it("accepts a valid playbook", () => {
    expect(validatePlaybookFile(VALID_PLAYBOOK)).toBe(true);
  });

  it("rejects a playbook missing ## Executive Summary", () => {
    const bad = VALID_PLAYBOOK.replace("## Executive Summary", "## Overview");
    expect(validatePlaybookFile(bad)).toBe(false);
  });

  it("rejects a playbook missing ## Source Index", () => {
    const bad = VALID_PLAYBOOK.replace("## Source Index", "## Links");
    expect(validatePlaybookFile(bad)).toBe(false);
  });

  it("rejects a playbook missing ## Red Flags: Auto-Disqualify Signals", () => {
    const bad = VALID_PLAYBOOK.replace("## Red Flags: Auto-Disqualify Signals", "## Warnings");
    expect(validatePlaybookFile(bad)).toBe(false);
  });
});

describe("buildResearchContext", () => {
  it("combines research files into labelled sections", () => {
    const ctx = buildResearchContext({ "keyword-patterns": VALID_RESEARCH });
    expect(ctx).toContain("=== KEYWORD-PATTERNS RESEARCH ===");
    expect(ctx).toContain("Sources consulted: 42");
  });

  it("skips null files", () => {
    const ctx = buildResearchContext({
      "keyword-patterns": VALID_RESEARCH,
      "market-data": null,
    });
    expect(ctx).not.toContain("MARKET-DATA");
  });
});

describe("RESEARCH_FILE_NAMES_A1", () => {
  it("contains all 6 expected file names", () => {
    expect(RESEARCH_FILE_NAMES_A1).toContain("keyword-patterns.md");
    expect(RESEARCH_FILE_NAMES_A1).toContain("market-data.md");
    expect(RESEARCH_FILE_NAMES_A1).toContain("competitor-keywords.md");
    expect(RESEARCH_FILE_NAMES_A1).toContain("local-seo.md");
    expect(RESEARCH_FILE_NAMES_A1).toContain("ppc-economics.md");
    expect(RESEARCH_FILE_NAMES_A1).toContain("gbp-competition.md");
    expect(RESEARCH_FILE_NAMES_A1).toHaveLength(6);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/agents/agent-1-keywords/research-reader.test.ts
```

Expected: FAIL — `research-reader.ts` does not exist yet.

**Step 3: Implement research-reader.ts**

Create `src/agents/agent-1-keywords/research-reader.ts`:

```typescript
// Re-export Agent 2's reader functions — the research file format is identical.
export {
  readResearchFile,
  validateResearchFile,
  buildResearchContext,
} from "../agent-2-design/research-reader.js";

export const RESEARCH_FILE_NAMES_A1 = [
  "keyword-patterns.md",
  "market-data.md",
  "competitor-keywords.md",
  "local-seo.md",
  "ppc-economics.md",
  "gbp-competition.md",
] as const;

const REQUIRED_PLAYBOOK_SECTIONS = [
  /^## Executive Summary$/m,
  /^## Market Sizing & Economics$/m,
  /^## Two-Pipeline Candidate Logic$/m,
  /^## Climate & Pest Pressure Scoring$/m,
  /^## Competition Scoring Model$/m,
  /^## Keyword Patterns & Intent Classification$/m,
  /^## Competitor URL Patterns$/m,
  /^## Pay-Per-Call Economics$/m,
  /^## Red Flags: Auto-Disqualify Signals$/m,
  /^## Free Tool Stack$/m,
  /^## Source Index$/m,
];

export function validatePlaybookFile(content: string): boolean {
  return REQUIRED_PLAYBOOK_SECTIONS.every((pattern) => pattern.test(content));
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/agents/agent-1-keywords/research-reader.test.ts
```

Expected: PASS, all tests green.

**Step 5: Commit**

```bash
git add src/agents/agent-1-keywords/research-reader.ts src/agents/agent-1-keywords/research-reader.test.ts
git commit -m "feat(agent-1): add research reader with playbook validation"
```

---

## Task 3: Create subagent prompts for Agent 1

Six prompt builders — one per research subagent. Each produces a prompt that instructs a Sonnet subagent to browse real web sources and write a mandatory-format markdown file.

**Files:**
- Create: `src/agents/agent-1-keywords/subagent-prompts.ts`
- Create: `src/agents/agent-1-keywords/subagent-prompts.test.ts`

**Step 1: Write the failing tests**

Create `src/agents/agent-1-keywords/subagent-prompts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildKeywordPatternResearcherPrompt,
  buildMarketDataResearcherPrompt,
  buildCompetitorKeywordResearcherPrompt,
  buildLocalSeoResearcherPrompt,
  buildPpcEconomicsResearcherPrompt,
  buildGbpCompetitionResearcherPrompt,
} from "./subagent-prompts.js";

const cfg = { niche: "pest control", researchDir: "tmp/agent1-research/test-run" };

describe("buildKeywordPatternResearcherPrompt", () => {
  it("includes the output file path", () => {
    const p = buildKeywordPatternResearcherPrompt(cfg);
    expect(p).toContain("tmp/agent1-research/test-run/keyword-patterns.md");
  });

  it("targets at least 60 keyword patterns", () => {
    const p = buildKeywordPatternResearcherPrompt(cfg);
    expect(p).toContain("60");
  });

  it("includes the mandatory file format", () => {
    const p = buildKeywordPatternResearcherPrompt(cfg);
    expect(p).toContain("## Key Findings");
    expect(p).toContain("## Source Index");
    expect(p).toContain("**Evidence:**");
  });
});

describe("buildMarketDataResearcherPrompt", () => {
  it("includes the output file path", () => {
    const p = buildMarketDataResearcherPrompt(cfg);
    expect(p).toContain("tmp/agent1-research/test-run/market-data.md");
  });

  it("covers all 4 US climate regions", () => {
    const p = buildMarketDataResearcherPrompt(cfg);
    expect(p).toContain("Southeast");
    expect(p).toContain("Southwest");
    expect(p).toContain("Northeast");
    expect(p).toContain("Midwest");
  });
});

describe("buildCompetitorKeywordResearcherPrompt", () => {
  it("includes the output file path", () => {
    const p = buildCompetitorKeywordResearcherPrompt(cfg);
    expect(p).toContain("tmp/agent1-research/test-run/competitor-keywords.md");
  });

  it("targets at least 50 URL patterns", () => {
    const p = buildCompetitorKeywordResearcherPrompt(cfg);
    expect(p).toContain("50");
  });
});

describe("buildLocalSeoResearcherPrompt", () => {
  it("includes the output file path", () => {
    const p = buildLocalSeoResearcherPrompt(cfg);
    expect(p).toContain("tmp/agent1-research/test-run/local-seo.md");
  });

  it("mentions rank-and-rent model", () => {
    const p = buildLocalSeoResearcherPrompt(cfg);
    expect(p.toLowerCase()).toContain("rank-and-rent");
  });
});

describe("buildPpcEconomicsResearcherPrompt", () => {
  it("includes the output file path", () => {
    const p = buildPpcEconomicsResearcherPrompt(cfg);
    expect(p).toContain("tmp/agent1-research/test-run/ppc-economics.md");
  });

  it("targets pay-per-call network research", () => {
    const p = buildPpcEconomicsResearcherPrompt(cfg);
    expect(p.toLowerCase()).toContain("pay-per-call");
  });
});

describe("buildGbpCompetitionResearcherPrompt", () => {
  it("includes the output file path", () => {
    const p = buildGbpCompetitionResearcherPrompt(cfg);
    expect(p).toContain("tmp/agent1-research/test-run/gbp-competition.md");
  });

  it("mentions GBP density analysis", () => {
    const p = buildGbpCompetitionResearcherPrompt(cfg);
    expect(p.toLowerCase()).toContain("gbp");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/agents/agent-1-keywords/subagent-prompts.test.ts
```

Expected: FAIL — module does not exist.

**Step 3: Implement subagent-prompts.ts**

Create `src/agents/agent-1-keywords/subagent-prompts.ts`:

```typescript
export interface SubagentPromptConfig {
  niche: string;
  researchDir: string;
}

const RESEARCH_FILE_FORMAT = `
Use this exact format for your output file:

# [Domain] Research — {niche}

**Subagent:** [your-subagent-name]
**Sources consulted:** [number]
**Date:** [today's ISO date]

## Key Findings

### [Finding Title]
**Evidence:** [Source URL or named study]
**Data:** [Specific numbers, percentages, dollar amounts]
**Implication:** [What this means for keyword strategy or market selection]

[Repeat for each major finding — aim for 15-25 findings]

## Source Index
- [URL] — [one-line description of what was found]
[All sources you actually visited, one per line]
`;

export function buildKeywordPatternResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a keyword research specialist for local service businesses in the pest control vertical.

Your task: Find real keyword patterns that pest control customers actually search for — not what you think they search for, but what real SERP data and studies show.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/keyword-patterns.md

RESEARCH APPROACH (follow this order):
1. Search "pest control keyword research SEMrush 2025" and "pest control SEO keyword data"
2. Search "pest control search terms customers use" and "exterminator keywords high intent"
3. Search "local pest control landing page keywords that convert"
4. Search Google Autocomplete patterns: fetch "https://www.google.com/complete/search?q=pest+control+&client=firefox" and similar for "exterminator", "termite control", "wildlife removal"
5. Search "pest control keyword intent analysis" and "transactional vs informational pest keywords"
6. Search Ahrefs/SEMrush blog posts on "pest control SEO" for keyword data
7. Search "wildlife removal keywords" — separately, this is a distinct high-value niche
8. Search "bed bug exterminator keywords" — another distinct high-value niche
9. Search "termite inspection keywords" and "termite treatment search terms"
10. Search "pest control people also ask SERP features"
11. Search for actual pest control PPC ad copy — what terms are advertisers bidding on?
12. Visit at least 10 real pest control sites and extract their title tags and URL slugs

TARGET: Identify 60+ distinct keyword patterns across all intent types (emergency, prevention, inspection, treatment, pricing, near-me). For each pattern, estimate monthly volume range and classify intent.

DO NOT overlap with: competitor URL structures (that's competitor-keyword-researcher's job), local SEO factors, or market economics.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/keyword-patterns.md using the Write tool. Do not return the content in your response.`;
}

export function buildMarketDataResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a market research analyst specializing in US geographic demand signals for pest control services.

Your task: Find real data on pest control market characteristics by US region and climate zone.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/market-data.md

RESEARCH APPROACH (follow this order):
1. Search "NPMA National Pest Management Association industry report" for market size and regional data
2. Search "pest control demand by state" and "which states have highest pest problems"
3. Fetch NOAA climate data documentation: search "NOAA CDO API temperature precipitation by city free"
4. Search "HUD termite infestation probability zones" and "TIP zone 1 states pest control"
5. Search "USDA hardiness zones pest activity correlation"
6. Search "Google Trends pest control by state" and look for regional patterns
7. Search "termite activity by state" — find the HUD or USDA data on termite pressure
8. Search "pest pressure Southeast vs Midwest vs Northeast US"
9. Search "Florida pest control market size" and "Texas pest control market"
10. Search "pest control seasonal demand by region"
11. Search "homeownership rate by city pest control demand"
12. Search "Census Bureau ACS housing data pest control markets"

TARGET: Cover all 4 US climate regions (Southeast, Southwest, Northeast, Midwest) with specific city-level pest pressure signals where available. Include the scoring model components: temperature, precipitation, TIP zones, hardiness zones. Cite specific free API sources (api.census.gov, NOAA CDO) with URLs.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/market-data.md using the Write tool. Do not return the content in your response.`;
}

export function buildCompetitorKeywordResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are an SEO analyst specializing in rank-and-rent and lead generation sites in the pest control vertical.

Your task: Analyze what URL structures and keyword patterns the top-ranking pest control lead-gen sites actually use.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/competitor-keywords.md

RESEARCH APPROACH (follow this order):
1. Search "pest control [city]" for 8 cities: Houston, Phoenix, Atlanta, Tampa, Charlotte, Denver, Raleigh, Orlando
2. For each SERP, identify which results are rank-and-rent / lead-gen sites (not franchise homepages, not Yelp)
3. Visit each lead-gen site — extract: URL slug pattern, title tag format, H1 text, service page structure
4. Search "exterminator near me" and "termite control [city]" SERPs for more samples
5. Search "best pest control websites lead generation" and "rank and rent pest control site examples"
6. Search "pest control lead gen site URL structure SEO"
7. Look for patterns: do top sites use /pest-control-[city]/ or /[city]/pest-control/ or /[city]-pest-control/?
8. Search "pest control affiliate site keyword strategy"
9. Search "wildlife removal lead gen site keyword structure"
10. Search "pest control service page URL best practices local SEO"
11. Visit 15+ actual pest control rank-and-rent URLs and document their slug patterns

TARGET: 50+ real competitor URL patterns with keyword intent mapping. Identify which slug formats dominate for high-ranking lead-gen sites. Note which keyword → page mapping strategies appear most frequently.

DO NOT overlap with: local SEO ranking factors (that's local-seo-researcher's job), keyword search volumes.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/competitor-keywords.md using the Write tool. Do not return the content in your response.`;
}

export function buildLocalSeoResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a local SEO specialist focused on service area businesses without a Google Business Profile — the rank-and-rent model specifically.

Your task: Find real data on local SEO ranking factors for pest control sites that do NOT have a GBP.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/local-seo.md

RESEARCH APPROACH (follow this order):
1. Search "Whitespark local search ranking factors 2025 2026" — fetch and extract the factor weights
2. Search "rank and rent local SEO without Google Business Profile"
3. Search "city + service page ranking factors 2025"
4. Search "local SEO without GBP how to rank" — find case studies
5. Search "pest control website ranking without Google Maps listing"
6. Search "local service area business SEO no physical address"
7. Search "Google Vicinity Update proximity impact local rankings"
8. Search "city page optimization best practices local service SEO"
9. Search "NAP citations for rank and rent sites"
10. Search "keyword difficulty city + pest control" — find benchmarks
11. Search "Google Business Profile lead generation prohibition enforcement 2024 2025"
12. Search "local pack ranking signals on-page vs off-page 2025"
13. Search "local SEO single page vs multi-page service site pest control"

TARGET: 40+ data points on ranking factors specific to the rank-and-rent model. Include the Whitespark factor weights if found. Note what works for sites without GBP, proximity signals, and the GBP prohibition situation.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/local-seo.md using the Write tool. Do not return the content in your response.`;
}

export function buildPpcEconomicsResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a pay-per-call lead generation analyst specializing in home services and pest control.

Your task: Find real pay-per-call rates, CPL benchmarks, and lead value data for pest control markets.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/ppc-economics.md

RESEARCH APPROACH (follow this order):
1. Search "pest control pay per call rates 2024 2025" — find actual dollar amounts
2. Search "Marketcall pest control lead price" and "Soleo pest control CPL"
3. Search "Service Direct pest control cost per lead" — they publish some data
4. Search "pest control lead generation cost per acquisition"
5. Search "pest control customer lifetime value" — what companies will pay for leads
6. Search "pest control average job value residential" — what a booked job is worth
7. Search "termite treatment average cost" and "bed bug treatment cost"
8. Search "wildlife removal average job value"
9. Search "rank and rent pest control monthly rent price"
10. Search "pest control Google Ads CPC 2024 2025" — what the market pays for clicks
11. Search "pest control call conversion rate booked appointment"
12. Search "pest control lead generation ROI case study"
13. Search "pest control franchise acquiring leads third party"

TARGET: Real dollar amounts for: pay-per-call rates by niche ($20–$300 range), average job values by pest type, CPL benchmarks by market size (suburb vs small city vs medium city), estimated monthly rent/revenue for rank-and-rent sites. Note which niches have the best value-to-competition ratio.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/ppc-economics.md using the Write tool. Do not return the content in your response.`;
}

export function buildGbpCompetitionResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a local search competitive analyst specializing in Google Maps, Local Service Ads, and franchise dynamics for pest control.

Your task: Find real data on GBP density, Map Pack saturation, and franchise presence patterns that signal market opportunity or saturation.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/gbp-competition.md

RESEARCH APPROACH (follow this order):
1. Search "pest control Google Maps listings density by city"
2. Search "how many pest control companies per city market saturated"
3. Search "Terminix Rentokil acquisition impact local pest control 2024"
4. Search "Orkin franchise presence US cities pest control"
5. Search "Aptive pest control locations US"
6. Search "pest control Local Service Ads competition 2024 2025"
7. Search "Google Maps pest control reviews distribution" — what's a dominant vs weak competitor
8. Search "pest control Google review count competitive threshold"
9. Search "pest control franchise vs independent market share"
10. Search "Rentokil Terminix integration problems 2024" — find the competitive gap
11. Search "pest control GBP Google Business Profile lead gen prohibition lawsuit"
12. Search "pest control Map Pack saturation signals"
13. Search "Google Local Service Ads pest control cost impressions"

TARGET: Competition scoring thresholds — GBP count ranges by market size (5–15 is ideal for mid-size), review count cutoffs that signal locked vs open markets (<75 avg = opportunity, >300 = locked), franchise count signals (0–1 = open, 2–3 = monetizable, 4+ = saturated). Document the Rentokil/Terminix disruption window.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/gbp-competition.md using the Write tool. Do not return the content in your response.`;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/agents/agent-1-keywords/subagent-prompts.test.ts
```

Expected: PASS, all tests green.

**Step 5: Commit**

```bash
git add src/agents/agent-1-keywords/subagent-prompts.ts src/agents/agent-1-keywords/subagent-prompts.test.ts
git commit -m "feat(agent-1): add 6 research subagent prompts"
```

---

## Task 4: Create research orchestrator for Agent 1

Wraps the Agent SDK `query()` call, spawns 6 subagents in parallel, validates results, and returns findings as structured data.

**Files:**
- Create: `src/agents/agent-1-keywords/research-orchestrator.ts`
- Create: `src/agents/agent-1-keywords/research-orchestrator.test.ts`

**Step 1: Write the failing tests**

Create `src/agents/agent-1-keywords/research-orchestrator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  RESEARCH_FILE_NAMES_A1,
} from "./research-reader.js";
import {
  type ResearchFindings,
} from "./research-orchestrator.js";

// We test the type shape and file name constants, not the live query() call
// (that's tested in the integration run in Task 7).

describe("ResearchFindings type", () => {
  it("has all 6 required finding fields", () => {
    const sample: ResearchFindings = {
      keywordPatterns: null,
      marketData: null,
      competitorKeywords: null,
      localSeo: null,
      ppcEconomics: null,
      gbpCompetition: null,
    };
    expect(sample).toBeDefined();
    expect(Object.keys(sample)).toHaveLength(6);
  });
});

describe("RESEARCH_FILE_NAMES_A1", () => {
  it("maps to 6 unique file names", () => {
    const unique = new Set(RESEARCH_FILE_NAMES_A1);
    expect(unique.size).toBe(6);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/agents/agent-1-keywords/research-orchestrator.test.ts
```

Expected: FAIL — module does not exist.

**Step 3: Implement research-orchestrator.ts**

Create `src/agents/agent-1-keywords/research-orchestrator.ts`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildKeywordPatternResearcherPrompt,
  buildMarketDataResearcherPrompt,
  buildCompetitorKeywordResearcherPrompt,
  buildLocalSeoResearcherPrompt,
  buildPpcEconomicsResearcherPrompt,
  buildGbpCompetitionResearcherPrompt,
} from "./subagent-prompts.js";
import {
  readResearchFile,
  validateResearchFile,
} from "./research-reader.js";

export interface ResearchFindings {
  keywordPatterns: string | null;
  marketData: string | null;
  competitorKeywords: string | null;
  localSeo: string | null;
  ppcEconomics: string | null;
  gbpCompetition: string | null;
}

export interface ResearchPhaseConfig {
  niche: string;
  researchDir: string;
}

export async function runResearchPhase(
  cfg: ResearchPhaseConfig
): Promise<ResearchFindings> {
  mkdirSync(cfg.researchDir, { recursive: true });
  console.log(`[Agent 1][Research] Starting research phase for "${cfg.niche}"`);
  console.log(`[Agent 1][Research] Research dir: ${cfg.researchDir}`);

  const orchestratorPrompt = buildOrchestratorPrompt(cfg);

  for await (const message of query({
    prompt: orchestratorPrompt,
    options: {
      allowedTools: ["Task", "Write", "Read", "WebSearch", "WebFetch"],
      agents: {
        "keyword-pattern-researcher": {
          description: "Finds real keyword patterns pest control customers search for — SERP analysis, autocomplete, intent classification. Use for keyword template research.",
          prompt: buildKeywordPatternResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "market-data-researcher": {
          description: "Finds US regional pest control market data — NOAA climate, HUD TIP zones, NPMA reports, demographic signals. Use for market sizing and climate scoring data.",
          prompt: buildMarketDataResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "competitor-keyword-researcher": {
          description: "Analyzes URL slug patterns and keyword structures of top-ranking rank-and-rent pest control sites. Use for competitor keyword structure research.",
          prompt: buildCompetitorKeywordResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "local-seo-researcher": {
          description: "Finds local SEO ranking factors for service businesses without a GBP — rank-and-rent model specifics. Use for local SEO factor data.",
          prompt: buildLocalSeoResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "ppc-economics-researcher": {
          description: "Finds pay-per-call rates, CPL benchmarks, and lead value data for pest control markets. Use for monetization economics research.",
          prompt: buildPpcEconomicsResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "gbp-competition-researcher": {
          description: "Analyzes GBP density, Map Pack saturation, franchise presence, and review distribution in pest control markets. Use for competition scoring threshold data.",
          prompt: buildGbpCompetitionResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
      },
    },
  })) {
    const msg = message as any;

    for (const block of msg.message?.content ?? []) {
      if (block.type === "tool_use" && block.name === "Task") {
        console.log(`[Agent 1][Research] Spawning subagent: ${block.input?.subagent_type ?? "unknown"}`);
      }
    }

    if ("is_error" in msg && msg.is_error) {
      throw new Error(`[Agent 1][Research] Research phase failed: ${msg.result}`);
    }

    if ("result" in msg) {
      console.log("[Agent 1][Research] Orchestrator complete");
    }
  }

  return readResearchFindings(cfg.researchDir);
}

function readResearchFindings(researchDir: string): ResearchFindings {
  const read = (filename: string): string | null => {
    const path = join(researchDir, filename);
    const content = readResearchFile(path);
    if (!content) {
      console.warn(`[Agent 1][Research] Warning: ${filename} not found after research`);
      return null;
    }
    if (!validateResearchFile(content)) {
      console.warn(`[Agent 1][Research] Warning: ${filename} failed validation (too short or missing required sections)`);
      return null;
    }
    const wordCount = content.split(/\s+/).length;
    console.log(`[Agent 1][Research] Loaded ${filename} (${wordCount} words)`);
    return content;
  };

  return {
    keywordPatterns: read("keyword-patterns.md"),
    marketData: read("market-data.md"),
    competitorKeywords: read("competitor-keywords.md"),
    localSeo: read("local-seo.md"),
    ppcEconomics: read("ppc-economics.md"),
    gbpCompetition: read("gbp-competition.md"),
  };
}

function buildOrchestratorPrompt(cfg: ResearchPhaseConfig): string {
  return `You are the lead market research orchestrator for a ${cfg.niche} keyword research and market selection system.

Your job: spawn all 6 research subagents IN PARALLEL using the Task tool simultaneously. Do not run them sequentially — call all 6 Task tools in the same response.

Research directory: ${cfg.researchDir}

The 6 subagents and what they do:
- keyword-pattern-researcher: finds real keyword patterns pest control customers search for
- market-data-researcher: finds US regional pest pressure and demographic data
- competitor-keyword-researcher: analyzes URL structures of top-ranking pest control lead-gen sites
- local-seo-researcher: finds ranking factors for sites without a Google Business Profile
- ppc-economics-researcher: finds pay-per-call rates and lead value benchmarks
- gbp-competition-researcher: finds GBP density and competition saturation thresholds

CRITICAL: Invoke all 6 simultaneously. Each will write its findings to a .md file in ${cfg.researchDir}.

Once all 6 complete, use the Read tool to verify each file exists and has content. If any file is missing or thin (under 300 words), note it but do not re-spawn — the calling code handles partial results.

Start wide: instruct each subagent to search broadly before drilling into specifics. Real data only — no synthesized summaries from training data. Quality over speed.`;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/agents/agent-1-keywords/research-orchestrator.test.ts
```

Expected: PASS.

**Step 5: Compile TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors in the new files.

**Step 6: Commit**

```bash
git add src/agents/agent-1-keywords/research-orchestrator.ts src/agents/agent-1-keywords/research-orchestrator.test.ts
git commit -m "feat(agent-1): add research orchestrator with 6 parallel subagents"
```

---

## Task 5: Update Agent 1 prompts to accept research context

Add `buildPlaybookSynthesisPrompt` (new) and wrapper functions for the 3 existing prompts that prepend research context when provided.

**Files:**
- Modify: `src/agents/agent-1-keywords/prompts.ts`
- Create: `src/agents/agent-1-keywords/prompts.test.ts`

**Step 1: Write the failing tests**

Create `src/agents/agent-1-keywords/prompts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildPlaybookSynthesisPrompt,
  withResearchContext,
  KEYWORD_TEMPLATE_PROMPT,
  CITY_SCORING_PROMPT,
  KEYWORD_CLUSTERING_PROMPT,
} from "./prompts.js";

describe("buildPlaybookSynthesisPrompt", () => {
  it("requires niche, researchContext, and runId", () => {
    const p = buildPlaybookSynthesisPrompt({
      niche: "pest control",
      researchContext: "=== RESEARCH ===\nsome findings",
      runId: "test-run-123",
    });
    expect(p).toContain("pest control");
    expect(p).toContain("=== RESEARCH ===");
    expect(p).toContain("test-run-123");
  });

  it("includes all required playbook section headers", () => {
    const p = buildPlaybookSynthesisPrompt({
      niche: "pest control",
      researchContext: "research data",
      runId: "run-1",
    });
    expect(p).toContain("## Executive Summary");
    expect(p).toContain("## Market Sizing & Economics");
    expect(p).toContain("## Two-Pipeline Candidate Logic");
    expect(p).toContain("## Climate & Pest Pressure Scoring");
    expect(p).toContain("## Competition Scoring Model");
    expect(p).toContain("## Keyword Patterns & Intent Classification");
    expect(p).toContain("## Competitor URL Patterns");
    expect(p).toContain("## Pay-Per-Call Economics");
    expect(p).toContain("## Red Flags: Auto-Disqualify Signals");
    expect(p).toContain("## Free Tool Stack");
    expect(p).toContain("## Source Index");
  });

  it("instructs the LLM to cite only evidence from research files", () => {
    const p = buildPlaybookSynthesisPrompt({
      niche: "pest control",
      researchContext: "research data",
      runId: "run-1",
    });
    expect(p.toLowerCase()).toContain("only cite");
  });
});

describe("withResearchContext", () => {
  it("prepends research context when provided", () => {
    const augmented = withResearchContext(KEYWORD_TEMPLATE_PROMPT, "RESEARCH CONTEXT HERE");
    expect(augmented).toContain("RESEARCH CONTEXT HERE");
    expect(augmented).toContain("Generate keyword templates");
  });

  it("returns the original prompt when no context provided", () => {
    const augmented = withResearchContext(KEYWORD_TEMPLATE_PROMPT, null);
    expect(augmented).toBe(KEYWORD_TEMPLATE_PROMPT);
  });

  it("does not change the output schema instructions", () => {
    const augmented = withResearchContext(CITY_SCORING_PROMPT, "some research");
    expect(augmented).toContain("Output ONLY valid JSON");
    expect(augmented).toContain("priority_score");
  });
});

describe("KEYWORD_TEMPLATE_PROMPT unchanged", () => {
  it("still exists as a named export", () => {
    expect(KEYWORD_TEMPLATE_PROMPT).toBeTruthy();
    expect(KEYWORD_TEMPLATE_PROMPT).toContain("{city}");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/agents/agent-1-keywords/prompts.test.ts
```

Expected: FAIL — `buildPlaybookSynthesisPrompt` and `withResearchContext` not exported yet.

**Step 3: Update prompts.ts**

Add the following exports to the end of `src/agents/agent-1-keywords/prompts.ts` (do not modify existing prompts):

```typescript
// --- Research-augmented prompt utilities ---

export interface PlaybookSynthesisPromptConfig {
  niche: string;
  researchContext: string;
  runId: string;
}

export function buildPlaybookSynthesisPrompt(cfg: PlaybookSynthesisPromptConfig): string {
  return `You are a market research analyst synthesizing field research into a professional market selection playbook for a ${cfg.niche} lead generation operation.

Run ID: ${cfg.runId}

You have been given research findings from 6 parallel research subagents that browsed real web sources. Your job is to synthesize these findings into a single comprehensive market selection playbook.

RESEARCH INPUT:
${cfg.researchContext}

---

Produce a market selection playbook in this EXACT structure. Do not skip any section. Use real numbers and cite sources from the research. Only cite evidence found in the research input above — do not invent data.

# ${cfg.niche.charAt(0).toUpperCase() + cfg.niche.slice(1)} Market Selection Playbook

**Generated:** [today's ISO date] | **Run ID:** ${cfg.runId} | **Sources consulted:** [count the unique URLs in the Source Index sections above]

## Executive Summary
[3-5 bullet points: most important findings, key opportunity thresholds, primary market tier recommendation]

## Market Sizing & Economics
[Industry size, growth rate, CLV, pay-per-call rate ranges by niche — cite from ppc-economics research]

## Two-Pipeline Candidate Logic

### Pipeline A: Standalone Cities (50K–300K)
[Decision thresholds with sources from market-data and gbp-competition research]

### Pipeline B: Suburbs (25K–100K in 500K+ metros)
[Decision thresholds, search identity test requirement, faster ranking rationale]

## Climate & Pest Pressure Scoring
[Scoring model with specific factor weights — cite from market-data research: NOAA, Frostline, HUD TIP zones]

## Competition Scoring Model
[GBP density thresholds, DA benchmarks, review count cutoffs — cite from gbp-competition research]

## Keyword Patterns & Intent Classification
[60+ keyword patterns grouped by intent: emergency / prevention / inspection / treatment / pricing — cite from keyword-patterns research]

## Competitor URL Patterns
[50+ real slug patterns with keyword intent mapping — cite from competitor-keywords research]

## Pay-Per-Call Economics
[Pay-per-call rates by niche, CPL benchmarks by market type, rank-and-rent revenue estimates — cite from ppc-economics research]

## Red Flags: Auto-Disqualify Signals
[Table format: signal | detection method | why it kills the market — cite from all research]

## Free Tool Stack
[Table format: tool | data provided | endpoint | rate limit — cite free tools found in market-data and local-seo research]

## Source Index
[All unique URLs found across all research files, one per line as: - [URL] — [description]]

---

Write the complete playbook now. Length target: 3,000-6,000 words. Do not truncate any section.`;
}

/**
 * Prepend research context to any existing prompt when available.
 * Returns the original prompt unchanged when researchContext is null.
 */
export function withResearchContext(
  prompt: string,
  researchContext: string | null
): string {
  if (!researchContext) {
    return prompt;
  }

  return `The following market research was gathered from real web sources. Use it to ground your response in actual data rather than general knowledge.

=== MARKET RESEARCH CONTEXT ===
${researchContext}
=== END MARKET RESEARCH CONTEXT ===

${prompt}`;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/agents/agent-1-keywords/prompts.test.ts
```

Expected: PASS.

**Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/agents/agent-1-keywords/prompts.ts src/agents/agent-1-keywords/prompts.test.ts
git commit -m "feat(agent-1): add playbook synthesis prompt and research context wrapper"
```

---

## Task 6: Wire Phase 1 into runAgent1()

Add Phase 1 (research) and Phase 2a (playbook synthesis) to `runAgent1()`. Pass the playbook and targeted research files as context to the 3 existing LLM calls.

**Files:**
- Modify: `src/agents/agent-1-keywords/index.ts`
- Modify: `src/agents/agent-1-keywords/index.ts` (also `getKeywordTemplates` signature)
- Create: `src/agents/agent-1-keywords/index.test.ts` (wiring smoke test)

**Step 1: Write a failing smoke test**

Create `src/agents/agent-1-keywords/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runAgent1, type Agent1Config } from "./index.js";

// Smoke test: verify Agent1Config accepts researchEnabled flag and runId
describe("Agent1Config interface", () => {
  it("accepts researchEnabled and runId fields", () => {
    const config: Agent1Config = {
      niche: "pest control",
      runId: "test-run",
      researchEnabled: false,
      candidateCities: [{ city: "Test", state: "TX", population: 100000 }],
    };
    expect(config.researchEnabled).toBe(false);
    expect(config.runId).toBe("test-run");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/agents/agent-1-keywords/index.test.ts
```

Expected: FAIL — `researchEnabled` not in `Agent1Config`.

**Step 3: Wire the research phase into index.ts**

Make these changes to `src/agents/agent-1-keywords/index.ts`:

**3a. Add imports** at the top of the file (after existing imports):

```typescript
import { join } from "node:path";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { runResearchPhase, type ResearchFindings } from "./research-orchestrator.js";
import {
  buildResearchContext,
  validatePlaybookFile,
} from "./research-reader.js";
import {
  buildPlaybookSynthesisPrompt,
  withResearchContext,
} from "./prompts.js";
```

**3b. Update `Agent1Config` interface** — add two optional fields:

```typescript
// Add inside Agent1Config interface:
researchEnabled?: boolean;   // default: false (opt-in)
researchDir?: string;        // default: tmp/agent1-research/{runId}
```

**3c. Update `getKeywordTemplates` signature** — add `researchContext` parameter:

Find the function signature:
```typescript
export async function getKeywordTemplates(
  niche: string,
  llm: LlmClient,
  db: DbClient,
  forceRefresh = false,
  offerProfile?: OfferProfile | null,
  verticalProfile?: VerticalProfile | null
): Promise<string[]>
```

Replace with:
```typescript
export async function getKeywordTemplates(
  niche: string,
  llm: LlmClient,
  db: DbClient,
  forceRefresh = false,
  offerProfile?: OfferProfile | null,
  verticalProfile?: VerticalProfile | null,
  researchContext?: string | null
): Promise<string[]>
```

Then in the function body, find the `llm.call` for keyword templates:
```typescript
  const { templates } = await llm.call({
    prompt: templatePrompt,
    schema: KeywordTemplatesResponseSchema,
    model: "haiku",
    logLabel: "[Agent 1][Step 1][Keyword templates]",
  });
```

Replace with:
```typescript
  const { templates } = await llm.call({
    prompt: withResearchContext(templatePrompt, researchContext ?? null),
    schema: KeywordTemplatesResponseSchema,
    model: "haiku",
    logLabel: "[Agent 1][Step 1][Keyword templates]",
  });
```

Also, when `researchContext` is provided, force refresh (bypass cache) and use higher confidence score:

Find in `getKeywordTemplates`:
```typescript
  if (!forceRefresh && Array.isArray(cachedTemplates) && cachedTemplates.length > 0 && isFresh) {
```

Replace with:
```typescript
  const effectiveForceRefresh = forceRefresh || Boolean(researchContext);
  if (!effectiveForceRefresh && Array.isArray(cachedTemplates) && cachedTemplates.length > 0 && isFresh) {
```

And update the confidence_score in the INSERT when research context is present. Find:
```typescript
     VALUES ($1, $2, 'llm', 'v1', 'generated', 0.65, now())
```

Replace with:
```typescript
     VALUES ($1, $2, 'llm', 'v1', researchContext ? 'research-grounded' : 'generated', researchContext ? 0.90 : 0.65, now())
```

Wait — that's not valid SQL template string. Instead, pass a variable for confidence:

Actually, simplify: just pass different values via the query parameters. Find the INSERT statement:

```typescript
  await db.query(
    `INSERT INTO keyword_templates
     (niche, templates, cache_provider, cache_version, retrieval_method, confidence_score, updated_at)
     VALUES ($1, $2, 'llm', 'v1', 'generated', 0.65, now())
     ON CONFLICT (niche)
     DO UPDATE SET
       templates = EXCLUDED.templates,
       cache_provider = EXCLUDED.cache_provider,
       cache_version = EXCLUDED.cache_version,
       retrieval_method = EXCLUDED.retrieval_method,
       confidence_score = EXCLUDED.confidence_score,
       updated_at = now()`,
    [cacheKey, templates]
  );
```

Replace with:
```typescript
  const retrievalMethod = researchContext ? "research-grounded" : "generated";
  const confidenceScore = researchContext ? 0.90 : 0.65;
  await db.query(
    `INSERT INTO keyword_templates
     (niche, templates, cache_provider, cache_version, retrieval_method, confidence_score, updated_at)
     VALUES ($1, $2, 'llm', 'v1', $3, $4, now())
     ON CONFLICT (niche)
     DO UPDATE SET
       templates = EXCLUDED.templates,
       cache_provider = EXCLUDED.cache_provider,
       cache_version = EXCLUDED.cache_version,
       retrieval_method = EXCLUDED.retrieval_method,
       confidence_score = EXCLUDED.confidence_score,
       updated_at = now()`,
    [cacheKey, templates, retrievalMethod, confidenceScore]
  );
```

**3d. Update `getScoredCities`** — add `researchContext` parameter:

Find:
```typescript
async function getScoredCities(
  config: Agent1Config,
  templates: string[],
  metrics: unknown[],
  llm: LlmClient,
  db: DbClient,
  forceRefresh = false
): Promise<ScoredCity[]>
```

Replace with:
```typescript
async function getScoredCities(
  config: Agent1Config,
  templates: string[],
  metrics: unknown[],
  llm: LlmClient,
  db: DbClient,
  forceRefresh = false,
  researchContext?: string | null
): Promise<ScoredCity[]>
```

Find in `getScoredCities` the `llm.call` for city scoring:
```typescript
    ({ scored_cities } = await llm.call({
      prompt: scoringPrompt,
      schema: CityScoringResponseSchema,
      model: "haiku",
      onOutput: (chunk, stream) => scoringLogger.onOutput(chunk, stream),
    }));
```

Replace with:
```typescript
    ({ scored_cities } = await llm.call({
      prompt: withResearchContext(scoringPrompt, researchContext ?? null),
      schema: CityScoringResponseSchema,
      model: "haiku",
      onOutput: (chunk, stream) => scoringLogger.onOutput(chunk, stream),
    }));
```

**3e. Wire Phase 1 + Phase 2a into `runAgent1()`**

In `runAgent1()`, add Phase 1 research block BEFORE the existing Step 1 (keyword templates). Find:

```typescript
  // Step 1: Load cached templates or generate them once per niche
  console.log("[Agent 1] Step 1: Loading keyword templates...");
```

Insert BEFORE that line:

```typescript
  // Phase 1: Deep research (optional — enabled via config.researchEnabled)
  let researchFindings: ResearchFindings | null = null;
  let playbookContent: string | null = null;
  let researchContextForTemplates: string | null = null;
  let researchContextForScoring: string | null = null;
  let researchContextForClustering: string | null = null;

  if (config.researchEnabled) {
    const runId = config.runId ?? `agent1-${Date.now()}`;
    const researchDir = config.researchDir ?? join("tmp", "agent1-research", runId);
    console.log("[Agent 1] Phase 1: Starting deep research...");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Research phase", detail: "Starting", timestamp: Date.now() });

    researchFindings = await runResearchPhase({ niche: config.niche, researchDir });

    const validCount = Object.values(researchFindings).filter(Boolean).length;
    console.log(`[Agent 1] Phase 1: Research complete — ${validCount}/6 files valid`);

    if (validCount < 4) {
      throw new Error(
        `[Agent 1] Research phase produced only ${validCount}/6 valid files. ` +
        "Aborting to prevent low-quality synthesis. Check subagent logs."
      );
    }

    // Phase 2a: Synthesize playbook from research findings
    console.log("[Agent 1] Phase 2a: Synthesizing market selection playbook...");
    const allResearchContext = buildResearchContext({
      "keyword-patterns": researchFindings.keywordPatterns,
      "market-data": researchFindings.marketData,
      "competitor-keywords": researchFindings.competitorKeywords,
      "local-seo": researchFindings.localSeo,
      "ppc-economics": researchFindings.ppcEconomics,
      "gbp-competition": researchFindings.gbpCompetition,
    });

    const playbookPrompt = buildPlaybookSynthesisPrompt({
      niche: config.niche,
      researchContext: allResearchContext,
      runId,
    });

    const playbookResult = await llm.call({
      prompt: playbookPrompt,
      model: "sonnet",
      logLabel: "[Agent 1][Phase 2a][Playbook synthesis]",
    });

    // llm.call with no schema returns the raw text
    playbookContent = typeof playbookResult === "string"
      ? playbookResult
      : JSON.stringify(playbookResult);

    if (!validatePlaybookFile(playbookContent)) {
      console.warn("[Agent 1] Playbook failed validation — missing required sections. Proceeding with research context only.");
      playbookContent = null;
    } else {
      // Save playbook permanently
      const playbookDir = join("docs", "playbooks", normalizeNiche(config.niche));
      mkdirSync(playbookDir, { recursive: true });
      const playbookPath = join(playbookDir, `${runId}-playbook.md`);
      writeFileSync(playbookPath, playbookContent, "utf8");
      console.log(`[Agent 1] Playbook saved to ${playbookPath}`);
      eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Playbook saved", detail: playbookPath, timestamp: Date.now() });
    }

    // Build targeted research contexts for each synthesis call
    const keywordResearch = buildResearchContext({
      "keyword-patterns": researchFindings.keywordPatterns,
      "competitor-keywords": researchFindings.competitorKeywords,
    });
    researchContextForTemplates = playbookContent
      ? `PLAYBOOK:\n${playbookContent}\n\nFOCUSED RESEARCH:\n${keywordResearch}`
      : keywordResearch;

    const scoringResearch = buildResearchContext({
      "market-data": researchFindings.marketData,
      "gbp-competition": researchFindings.gbpCompetition,
      "ppc-economics": researchFindings.ppcEconomics,
    });
    researchContextForScoring = playbookContent
      ? `PLAYBOOK:\n${playbookContent}\n\nFOCUSED RESEARCH:\n${scoringResearch}`
      : scoringResearch;

    const clusteringResearch = buildResearchContext({
      "keyword-patterns": researchFindings.keywordPatterns,
      "competitor-keywords": researchFindings.competitorKeywords,
      "local-seo": researchFindings.localSeo,
    });
    researchContextForClustering = playbookContent
      ? `PLAYBOOK:\n${playbookContent}\n\nFOCUSED RESEARCH:\n${clusteringResearch}`
      : clusteringResearch;
  }
```

**3f. Pass research context to `getKeywordTemplates`**

Find the call to `getKeywordTemplates`:
```typescript
  const templates = await getKeywordTemplates(
    config.niche,
    llm,
    db,
    config.forceRefresh,
    config.offerProfile,
    config.verticalProfile
  );
```

Replace with:
```typescript
  const templates = await getKeywordTemplates(
    config.niche,
    llm,
    db,
    config.forceRefresh,
    config.offerProfile,
    config.verticalProfile,
    researchContextForTemplates
  );
```

**3g. Pass research context to `getScoredCities`**

Find the call to `getScoredCities`:
```typescript
  const scored_cities = await getScoredCities(
    resolvedConfig,
    templates,
    metrics,
    llm,
    db,
    config.forceRefresh
  );
```

Replace with:
```typescript
  const scored_cities = await getScoredCities(
    resolvedConfig,
    templates,
    metrics,
    llm,
    db,
    config.forceRefresh,
    researchContextForScoring
  );
```

**3h. Pass research context to keyword clustering**

Find inside the per-city clustering loop the `clusterPrompt` usage:
```typescript
    const clusterResponse = await llm.call({
      prompt: clusterPrompt,
      schema: KeywordClusteringResponseSchema,
      model: "haiku",
      logLabel: `[Agent 1][Step 5][${city.city} clustering]`,
    });
```

Replace with:
```typescript
    const clusterResponse = await llm.call({
      prompt: withResearchContext(clusterPrompt, researchContextForClustering),
      schema: KeywordClusteringResponseSchema,
      model: "haiku",
      logLabel: `[Agent 1][Step 5][${city.city} clustering]`,
    });
```

**Step 4: Run the smoke test**

```bash
npx vitest run src/agents/agent-1-keywords/index.test.ts
```

Expected: PASS.

**Step 5: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: no errors. Fix any type errors before proceeding.

**Step 6: Run all Agent 1 tests**

```bash
npx vitest run src/agents/agent-1-keywords/
```

Expected: all existing tests still pass, new tests pass.

**Step 7: Commit**

```bash
git add src/agents/agent-1-keywords/index.ts src/agents/agent-1-keywords/index.test.ts
git commit -m "feat(agent-1): wire Phase 1 research and Phase 2a playbook synthesis into runAgent1"
```

---

## Task 7: Comparison report

Run Agent 1 twice — once without research, once with — and produce a before/after quality comparison document.

**Files:**
- Create: `docs/agent1-research-comparison.md` (produced by running the agent)

**Note:** This task requires a real Agent 1 run against a live DB. Run it in the development environment with a test niche.

**Step 1: Run WITHOUT research (baseline)**

```bash
# Set researchEnabled: false (default) — this is a normal run
# Record the run's output: keyword templates, city scores, cluster names
npx tsx src/cli.ts run-agent1 --niche "pest control" --cities "Lenexa,KS;Shawnee,KS" 2>&1 | tee /tmp/agent1-baseline.log
```

Note the timestamps, template count, and sample cluster names.

**Step 2: Run WITH research enabled**

```bash
npx tsx src/cli.ts run-agent1 --niche "pest control" --cities "Lenexa,KS;Shawnee,KS" --research --force-refresh 2>&1 | tee /tmp/agent1-research.log
```

Note the research dir path from the log — it will contain the 6 research files and playbook.

**Step 3: Produce comparison document**

Create `docs/agent1-research-comparison.md` manually (or ask Claude to draft it) using this template:

```markdown
# Agent 1 Research Phase: Before/After Comparison

## Run metadata
- Niche: [niche used]
- Date: [ISO date]
- Without research: [run timestamp from baseline log]
- With research: [run timestamp from research run log]

## Research phase stats (with research)
| Subagent | Sources consulted | File word count | Valid? |
|---|---|---|---|
| keyword-pattern-researcher | N | N | yes/no |
| market-data-researcher | N | N | yes/no |
| competitor-keyword-researcher | N | N | yes/no |
| local-seo-researcher | N | N | yes/no |
| ppc-economics-researcher | N | N | yes/no |
| gbp-competition-researcher | N | N | yes/no |
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
[2-3 paragraph comparison of output quality differences. Be specific: quote actual templates,
cluster names, and scoring reasoning from each run. Note which outputs are clearly grounded
in real data vs which appear to be generic training data hallucinations.]

## Verdict
[Did research phase improve output quality? By how much? Was the runtime cost (~10–15 min vs ~2 min) worth it?]
```

**Step 4: Commit**

```bash
git add docs/agent1-research-comparison.md
git commit -m "docs(agent-1): add before/after research comparison report"
```

---

## Integration test checklist

After all 7 tasks, verify end-to-end:

- [ ] `npx vitest run src/agents/agent-1-keywords/` — all unit tests pass
- [ ] `npx tsc --noEmit` — TypeScript compiles clean
- [ ] `docs/playbooks/pest-control/` directory exists with a playbook file after a research run
- [ ] Playbook file passes `validatePlaybookFile()` check
- [ ] All 6 research files in `tmp/agent1-research/{runId}/` pass `validateResearchFile()`
- [ ] `city_keyword_map` and `keyword_clusters` DB tables populated after research run (same schema as before)
- [ ] `docs/agent1-research-comparison.md` exists with filled-in data

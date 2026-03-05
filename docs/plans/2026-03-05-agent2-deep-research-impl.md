# Agent 2 Deep Research Rebuild — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Agent 2's 5 single-shot hallucinated LLM calls with a two-phase system: Phase 1 spawns 6 parallel research subagents via the Claude Agent SDK that browse 500–600 real web sources, Phase 2 feeds their findings into the existing synthesis calls.

**Architecture:** Agent SDK `query()` runs an Opus orchestrator that spawns 6 Sonnet subagents in parallel. Each subagent has `WebSearch` + `WebFetch` + `Write` tools and writes findings to `tmp/agent2-research/{runId}/*.md`. After all 6 complete, existing `llm.call()` synthesis reads those files as context and outputs the same DB schemas as today.

**Tech Stack:** TypeScript ESM, `@anthropic-ai/claude-agent-sdk`, Claude Code built-in `WebSearch`/`WebFetch`, existing Zod schemas, existing `llm.call()` for synthesis.

**Design doc:** `docs/plans/2026-03-05-agent2-deep-research-design.md`

---

## LLM Interface Contract

The subagents (LLM) write markdown files. The synthesis prompts (LLM via `llm.call()`) read those files as plain text. The contract between them is this mandatory file format:

```markdown
# [Domain] Research — [Niche]

**Subagent:** [subagent-name]
**Sources consulted:** [N]
**Date:** [ISO date]

## Key Findings

### [Finding Title]
**Evidence:** [Source URL or named study]
**Data:** [Specific numbers, percentages, CVR figures if available]
**Implication:** [What this means for the design/copy/schema]

[Repeat for each major finding]

## Source Index
- [URL] — [one-line description of what was found]
[All sources visited, one per line]
```

**Why this format matters:** Synthesis prompts will say "based on the following research, extract X." If subagents write freeform prose, the synthesis LLM cannot reliably locate evidence. The `## Key Findings` / `### [Title]` / `**Evidence:**` structure gives it reliable anchors.

Each subagent MUST write its file to the exact path given in its prompt. Each file MUST contain a `## Source Index` section. Synthesis will reject files shorter than 500 words.

---

## Task 1: Install Agent SDK

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

```bash
npm install @anthropic-ai/claude-agent-sdk
```

**Step 2: Verify TypeScript can import it**

Create a throwaway file `src/agents/agent-2-design/_sdk-check.ts`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
// If this compiles, we're good. Delete this file after.
void query;
```

**Step 3: Compile check**

```bash
npx tsc --noEmit
```

Expected: zero errors. If you see "Cannot find module '@anthropic-ai/claude-agent-sdk'", the install failed — re-run step 1.

**Step 4: Delete the check file and commit**

```bash
rm src/agents/agent-2-design/_sdk-check.ts
git add package.json package-lock.json
git commit -m "deps: add @anthropic-ai/claude-agent-sdk"
```

---

## Task 2: Create research file reader utility

This is the code-side of the LLM interface contract. It reads subagent output files and validates they meet the minimum format before passing them to synthesis.

**Files:**
- Create: `src/agents/agent-2-design/research-reader.ts`
- Create: `src/agents/agent-2-design/research-reader.test.ts`

**Step 1: Write the failing tests**

`src/agents/agent-2-design/research-reader.test.ts`:

```typescript
import { readResearchFile, validateResearchFile, buildResearchContext } from "./research-reader.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = join(tmpdir(), "research-reader-test-" + Date.now());

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const VALID_FILE = `# Competitor Research — pest control

**Subagent:** competitor-analyzer
**Sources consulted:** 87
**Date:** 2026-03-05

## Key Findings

### Top CTA Pattern
**Evidence:** https://example.com/pest-control
**Data:** 76% of top-ranking sites use sticky click-to-call on mobile
**Implication:** Sticky bar is mandatory, not optional

## Source Index
- https://example.com — example site with sticky CTA
`;

describe("readResearchFile", () => {
  it("reads an existing file", () => {
    const path = join(TMP, "competitors.md");
    writeFileSync(path, VALID_FILE, "utf8");
    const content = readResearchFile(path);
    expect(content).toBe(VALID_FILE);
  });

  it("returns null for missing file", () => {
    const content = readResearchFile(join(TMP, "missing.md"));
    expect(content).toBeNull();
  });
});

describe("validateResearchFile", () => {
  it("passes a valid file", () => {
    expect(validateResearchFile(VALID_FILE)).toBe(true);
  });

  it("fails a file with no Source Index", () => {
    const bad = VALID_FILE.replace("## Source Index", "## Sources");
    expect(validateResearchFile(bad)).toBe(false);
  });

  it("fails a file shorter than 500 words", () => {
    expect(validateResearchFile("too short")).toBe(false);
  });
});

describe("buildResearchContext", () => {
  it("combines multiple files with section headers", () => {
    const files = { competitors: VALID_FILE, cro: VALID_FILE };
    const ctx = buildResearchContext(files);
    expect(ctx).toContain("=== COMPETITORS RESEARCH ===");
    expect(ctx).toContain("=== CRO RESEARCH ===");
  });

  it("omits null files", () => {
    const ctx = buildResearchContext({ competitors: VALID_FILE, schema: null });
    expect(ctx).toContain("=== COMPETITORS RESEARCH ===");
    expect(ctx).not.toContain("=== SCHEMA RESEARCH ===");
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
npx jest src/agents/agent-2-design/research-reader.test.ts --no-coverage
```

Expected: `Cannot find module './research-reader.js'`

**Step 3: Implement**

`src/agents/agent-2-design/research-reader.ts`:

```typescript
import { readFileSync, existsSync } from "node:fs";

const MIN_WORD_COUNT = 500;

export function readResearchFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function validateResearchFile(content: string): boolean {
  if (!content.includes("## Source Index")) return false;
  const words = content.trim().split(/\s+/).length;
  if (words < MIN_WORD_COUNT) return false;
  return true;
}

export function buildResearchContext(
  files: Record<string, string | null>
): string {
  return Object.entries(files)
    .filter(([, content]) => content !== null)
    .map(([key, content]) => `=== ${key.toUpperCase()} RESEARCH ===\n\n${content}`)
    .join("\n\n---\n\n");
}
```

**Step 4: Run tests — expect PASS**

```bash
npx jest src/agents/agent-2-design/research-reader.test.ts --no-coverage
```

Expected: 7 tests pass.

**Step 5: Commit**

```bash
git add src/agents/agent-2-design/research-reader.ts src/agents/agent-2-design/research-reader.test.ts
git commit -m "feat(agent-2): add research file reader with validation"
```

---

## Task 3: Create subagent prompts

Six prompts — one per research domain. Each prompt must tell the subagent: what to search for, how many searches to do, what to extract from each page, the exact file path to write, and the required output format.

**Files:**
- Create: `src/agents/agent-2-design/subagent-prompts.ts`

**No tests for this task** — prompts are configuration, not logic. Quality is validated in the integration test (Task 7).

**Implementation:**

`src/agents/agent-2-design/subagent-prompts.ts`:

```typescript
export interface SubagentPromptConfig {
  niche: string;
  researchDir: string;
}

const RESEARCH_FILE_FORMAT = `
Use this exact format for your output file:

# [Domain] Research — {niche}

**Subagent:** [your name]
**Sources consulted:** [number]
**Date:** [today's date]

## Key Findings

### [Finding Title]
**Evidence:** [Source URL or named study]
**Data:** [Specific numbers, percentages if available]
**Implication:** [What this means for the design]

[Repeat for each major finding — aim for 15-25 findings]

## Source Index
- [URL] — [one-line description]
[All sources you visited, one per line]
`;

export function buildCompetitorAnalystPrompt(cfg: SubagentPromptConfig): string {
  return `You are a conversion rate optimization analyst specializing in local service business landing pages.

Your task: Research the top-ranking pest control websites across multiple US markets and extract concrete patterns that drive phone call conversions.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/competitors.md

RESEARCH APPROACH (follow this order):
1. Search "best pest control websites [city]" for 8 cities: Houston, Phoenix, Atlanta, Dallas, Tampa, Chicago, Denver, Miami
2. Search "pest control landing page examples" and "pest control website design"
3. Search "rank-and-rent pest control sites top converting"
4. For each site you find, use WebFetch to visit the actual URL and extract:
   - Exact layout and section order (hero → trust bar → services → etc.)
   - CTA text word-for-word and placement (sticky, hero, mid-page, footer)
   - Trust signals: what they are and where they appear
   - Phone number display: size, frequency, format
   - Mobile behavior: sticky bars, click-to-call
   - Form fields: how many, what type
   - Copy reading level and tone
   - Schema markup if visible in source
   - Any A/B test indicators or test variants

TARGET: Visit at least 80 real pest control URLs. Do not stop at 20 — keep searching and visiting.

DO NOT overlap with: CRO studies, color theory, copywriting formulas — those are other subagents' jobs. Focus only on what real competitor sites are actually doing.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/competitors.md using the Write tool. Do not return the content in your response — write it to the file.`;
}

export function buildCroResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a conversion rate optimization researcher with expertise in landing page performance data.

Your task: Find real CRO case studies, A/B test results, and conversion benchmarks specifically for local service business landing pages and phone call conversions.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/cro-data.md

RESEARCH APPROACH:
1. Search "pest control landing page conversion rate benchmark"
2. Search "local service business landing page A/B test results"
3. Search "click-to-call conversion rate local services"
4. Search "Unbounce landing page benchmark report home services"
5. Search "phone call conversion rate home services Invoca"
6. Search "sticky click-to-call mobile conversion lift data"
7. Search "CTA button color A/B test local service"
8. Search "landing page reading level conversion rate"
9. Search "trust badge conversion lift A/B test data"
10. Search "multi-step form conversion rate versus single step"
11. Search "social proof landing page conversion lift"
12. Search "exit intent popup conversion rate"
13. For each study found, WebFetch the actual page to get specific data points

TARGET: Find at least 80 distinct data points with sources. Every claim must have a source URL or named study.

DO NOT make up statistics. If you cannot find real data for something, say so. Only report verified numbers.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/cro-data.md using the Write tool.`;
}

export function buildDesignResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a UX and visual design researcher specializing in conversion-optimized landing pages.

Your task: Find real research and data on visual design elements that drive conversions — colors, typography, layout, mobile UX, page speed.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/design.md

RESEARCH APPROACH:
1. Search "color psychology conversion rate orange vs green button"
2. Search "font size landing page conversion rate mobile"
3. Search "above fold CTA conversion rate data"
4. Search "sticky header conversion rate impact"
5. Search "page speed conversion rate impact local service"
6. Search "Core Web Vitals conversion rate correlation"
7. Search "mobile tap target size conversion rate"
8. Search "hero image conversion rate real photo vs stock"
9. Search "section layout order conversion pest control home service"
10. Search "whitespace landing page conversion impact"
11. Search "before after photo conversion lift"
12. Search "video hero section conversion rate"
13. Visit CXL, NNGroup, Baymard, and ConversionXL for relevant articles
14. WebFetch each relevant article to extract specific data points

TARGET: Find at least 80 distinct design-related data points with sources.

Include CSS-level specifications where you can find them: exact pixel sizes that outperform, specific color contrast ratios, proven button dimension ranges.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/design.md using the Write tool.`;
}

export function buildCopyResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a direct-response copywriting researcher specializing in local service business conversion copy.

Your task: Find real data on which copywriting patterns, headline formulas, and CTA text drive the most phone call conversions.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/copy.md

RESEARCH APPROACH:
1. Search "best CTA button text A/B test results 2024 2025"
2. Search "first person CTA vs second person conversion rate data"
3. Search "headline formula conversion rate home services"
4. Search "loss aversion vs gain framing conversion rate"
5. Search "reading level landing page conversion Unbounce"
6. Search "pest control copywriting examples high converting"
7. Search "guarantee copy conversion rate impact"
8. Search "microcopy below CTA button conversion lift"
9. Search "urgency copy local service conversion"
10. Search "problem agitate solve PAS copywriting results"
11. Search "FAQ section conversion rate impact"
12. Search "social proof testimonial format conversion"
13. Search "CTA text 'submit' vs action words conversion data"
14. WebFetch the top results for each search

TARGET: Find at least 80 copy-related data points. For every CTA or headline recommendation, provide the source and % lift if available.

Include pest-control-specific examples where possible. Cover all four verticals: general pest, termites, bed bugs, wildlife/rodents.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/copy.md using the Write tool.`;
}

export function buildSchemaResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a technical SEO and structured data specialist.

Your task: Research the correct JSON-LD schema markup for local service businesses operating without a Google Business Profile (rank-and-rent model).

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/schema.md

RESEARCH APPROACH:
1. Search "PestControlService schema.org JSON-LD"
2. Search "LocalBusiness schema areaServed instead of address rank and rent"
3. Search "FAQPage schema requirements Google"
4. Search "Review schema visible on page requirement Google penalty"
5. Search "call tracking dynamic number insertion schema telephone"
6. Search "BreadcrumbList schema local service pages"
7. Search "AggregateRating schema requirements 2024 2025"
8. Visit schema.org/PestControlService directly
9. Search "schema markup local service business without physical address"
10. Search "JSON-LD vs microdata Google recommendation 2025"
11. WebFetch Google's structured data documentation pages
12. Search "schema.org Service provider LocalBusiness nesting"

TARGET: Find at least 40 sources. Include complete valid JSON-LD examples for each schema type — not just descriptions. Every template must be production-ready and spec-compliant.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/schema.md using the Write tool.`;
}

export function buildSeasonalResearcherPrompt(cfg: SubagentPromptConfig): string {
  return `You are a pest control industry analyst and seasonal marketing researcher.

Your task: Find real data on pest activity by month and region, and marketing spend benchmarks for the pest control industry.

NICHE: ${cfg.niche}
OUTPUT FILE: ${cfg.researchDir}/seasonal.md

RESEARCH APPROACH:
1. Search "pest control seasonal demand data month by month"
2. Search "termite swarm season by state month"
3. Search "NPMA pest control industry report seasonal"
4. Search "Google Trends pest control seasonal search volume"
5. Search "mosquito season by region US"
6. Search "rodent intrusion season fall winter data"
7. Search "bed bug season peak month data"
8. Search "pest control marketing spend by month budget allocation"
9. Search "Q2 pest control advertising spend benchmark"
10. Search "pest control seasonal keyword trends"
11. Visit NPMA.org for industry reports
12. Search "university extension pest activity seasonal calendar"
13. Search "Southeast pest control year round activity"
14. Search "Southwest scorpion season drywood termite season"
15. WebFetch the top results for each search

TARGET: Find at least 40 sources. Cover all four US climate regions: Southeast, Southwest, Northeast, Midwest. Include specific months and data where available — not vague seasonal claims.

${RESEARCH_FILE_FORMAT.replace("{niche}", cfg.niche)}

Write your findings to ${cfg.researchDir}/seasonal.md using the Write tool.`;
}
```

**Commit:**

```bash
git add src/agents/agent-2-design/subagent-prompts.ts
git commit -m "feat(agent-2): add 6 research subagent prompts"
```

---

## Task 4: Create research orchestrator

This is the `query()` call that runs the Opus orchestrator which spawns all 6 subagents in parallel.

**Files:**
- Create: `src/agents/agent-2-design/research-orchestrator.ts`
- Create: `src/agents/agent-2-design/research-orchestrator.test.ts`

**Step 1: Write tests (with mocked SDK)**

`src/agents/agent-2-design/research-orchestrator.test.ts`:

```typescript
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock the Agent SDK before importing orchestrator
jest.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: jest.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { runResearchPhase, RESEARCH_FILE_NAMES } from "./research-orchestrator.js";

const MOCK_RESEARCH_CONTENT = `# Competitor Research — pest control

**Subagent:** competitor-analyzer
**Sources consulted:** 87
**Date:** 2026-03-05

## Key Findings

### Sticky CTAs are universal
**Evidence:** https://example.com
**Data:** 80% of top-ranking sites use sticky mobile click-to-call
**Implication:** Sticky bar is mandatory

## Source Index
- https://example.com — top pest control site with sticky CTA
`.repeat(10); // repeat to exceed 500 word minimum

const mockedQuery = query as jest.Mock;

function makeAsyncGenerator(items: any[]) {
  return (async function* () { for (const item of items) yield item; })();
}

describe("runResearchPhase", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), "research-orch-test-" + Date.now());
    mkdirSync(testDir, { recursive: true });
    jest.clearAllMocks();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates research dir and resolves when query completes", async () => {
    // Simulate: query completes, subagents have written files
    mockedQuery.mockImplementation(() => {
      // Write mock files as if subagents ran
      for (const name of RESEARCH_FILE_NAMES) {
        writeFileSync(join(testDir, name), MOCK_RESEARCH_CONTENT, "utf8");
      }
      return makeAsyncGenerator([{ result: "Research complete" }]);
    });

    const result = await runResearchPhase({
      niche: "pest control",
      researchDir: testDir,
    });

    expect(result.competitors).toBeTruthy();
    expect(result.croData).toBeTruthy();
    expect(result.design).toBeTruthy();
    expect(result.copy).toBeTruthy();
    expect(result.schema).toBeTruthy();
    expect(result.seasonal).toBeTruthy();
  });

  it("throws if query emits an error result", async () => {
    mockedQuery.mockImplementation(() =>
      makeAsyncGenerator([{ is_error: true, result: "Something went wrong" }])
    );

    await expect(
      runResearchPhase({ niche: "pest control", researchDir: testDir })
    ).rejects.toThrow("Research phase failed");
  });

  it("warns but continues if a subagent file is missing", async () => {
    mockedQuery.mockImplementation(() => {
      // Only write 5 of 6 files — skip seasonal
      for (const name of RESEARCH_FILE_NAMES.filter(n => n !== "seasonal.md")) {
        writeFileSync(join(testDir, name), MOCK_RESEARCH_CONTENT, "utf8");
      }
      return makeAsyncGenerator([{ result: "Research complete" }]);
    });

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runResearchPhase({
      niche: "pest control",
      researchDir: testDir,
    });

    expect(result.seasonal).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("seasonal.md"));
    warnSpy.mockRestore();
  });
});
```

**Step 2: Run tests — expect FAIL**

```bash
npx jest src/agents/agent-2-design/research-orchestrator.test.ts --no-coverage
```

Expected: `Cannot find module './research-orchestrator.js'`

**Step 3: Implement**

`src/agents/agent-2-design/research-orchestrator.ts`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildCompetitorAnalystPrompt,
  buildCroResearcherPrompt,
  buildDesignResearcherPrompt,
  buildCopyResearcherPrompt,
  buildSchemaResearcherPrompt,
  buildSeasonalResearcherPrompt,
} from "./subagent-prompts.js";
import { readResearchFile, validateResearchFile } from "./research-reader.js";

export const RESEARCH_FILE_NAMES = [
  "competitors.md",
  "cro-data.md",
  "design.md",
  "copy.md",
  "schema.md",
  "seasonal.md",
] as const;

export interface ResearchFindings {
  competitors: string | null;
  croData: string | null;
  design: string | null;
  copy: string | null;
  schema: string | null;
  seasonal: string | null;
}

export interface ResearchPhaseConfig {
  niche: string;
  researchDir: string;
}

export async function runResearchPhase(
  cfg: ResearchPhaseConfig
): Promise<ResearchFindings> {
  mkdirSync(cfg.researchDir, { recursive: true });
  console.log(`[Agent 2][Research] Starting research phase for "${cfg.niche}"`);
  console.log(`[Agent 2][Research] Research dir: ${cfg.researchDir}`);

  const orchestratorPrompt = buildOrchestratorPrompt(cfg);

  for await (const message of query({
    prompt: orchestratorPrompt,
    options: {
      allowedTools: ["Task", "Write", "Read", "WebSearch", "WebFetch"],
      agents: {
        "competitor-analyzer": {
          description: "Visits real pest control websites across US markets and extracts CTA patterns, layout order, trust signals, and mobile behavior. Use for competitor research.",
          prompt: buildCompetitorAnalystPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "cro-researcher": {
          description: "Finds CRO case studies, A/B test results, and conversion benchmarks for local service landing pages. Use for conversion rate data.",
          prompt: buildCroResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "design-researcher": {
          description: "Researches visual design data — colors, typography, layout, mobile UX, page speed impact on conversions. Use for design specifications.",
          prompt: buildDesignResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "copy-researcher": {
          description: "Finds copywriting performance data — headline formulas, CTA text tests, reading level research, PAS scripts. Use for copy framework.",
          prompt: buildCopyResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "schema-researcher": {
          description: "Researches JSON-LD schema markup for local service businesses without a Google Business Profile. Use for schema templates.",
          prompt: buildSchemaResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "seasonal-researcher": {
          description: "Finds real pest activity data by month and region, and marketing spend benchmarks. Use for seasonal calendar.",
          prompt: buildSeasonalResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
      },
    },
  })) {
    const msg = message as any;

    // Log subagent invocations
    for (const block of msg.message?.content ?? []) {
      if (block.type === "tool_use" && block.name === "Task") {
        console.log(`[Agent 2][Research] Spawning subagent: ${block.input?.subagent_type ?? "unknown"}`);
      }
    }

    // Check for error
    if ("is_error" in msg && msg.is_error) {
      throw new Error(`Research phase failed: ${msg.result}`);
    }

    if ("result" in msg) {
      console.log(`[Agent 2][Research] Orchestrator complete`);
    }
  }

  return readResearchFindings(cfg.researchDir);
}

function readResearchFindings(researchDir: string): ResearchFindings {
  const read = (filename: string): string | null => {
    const path = join(researchDir, filename);
    const content = readResearchFile(path);
    if (!content) {
      console.warn(`[Agent 2][Research] Warning: ${filename} not found after research`);
      return null;
    }
    if (!validateResearchFile(content)) {
      console.warn(`[Agent 2][Research] Warning: ${filename} failed validation (too short or missing Source Index)`);
      return null;
    }
    console.log(`[Agent 2][Research] Loaded ${filename} (${content.split(/\s+/).length} words)`);
    return content;
  };

  return {
    competitors: read("competitors.md"),
    croData: read("cro-data.md"),
    design: read("design.md"),
    copy: read("copy.md"),
    schema: read("schema.md"),
    seasonal: read("seasonal.md"),
  };
}

function buildOrchestratorPrompt(cfg: ResearchPhaseConfig): string {
  return `You are the lead research orchestrator for a ${cfg.niche} landing page design system.

Your job: spawn all 6 research subagents IN PARALLEL using the Task tool simultaneously. Do not run them sequentially — call all 6 Task tools in the same response.

Research directory: ${cfg.researchDir}

The 6 subagents and what they do:
- competitor-analyzer: visits real ${cfg.niche} websites, extracts CTA and layout patterns
- cro-researcher: finds A/B test data and conversion benchmarks for local services
- design-researcher: researches color, typography, mobile UX conversion data
- copy-researcher: finds headline formula and CTA copy performance data
- schema-researcher: researches JSON-LD schema for local service businesses
- seasonal-researcher: finds pest activity data and marketing calendar benchmarks

CRITICAL: Invoke all 6 simultaneously. Each will write its findings to a .md file in ${cfg.researchDir}.

Once all 6 complete, use the Read tool to verify each file exists and has content. If any file is missing or appears thin (under 500 words), note it in your response but do not re-spawn — the calling code will handle it.

Start wide: instruct each subagent to begin with broad search terms before drilling into specifics. Quality over speed — we want real data, not the first results found.`;
}
```

**Step 4: Run tests — expect PASS**

```bash
npx jest src/agents/agent-2-design/research-orchestrator.test.ts --no-coverage
```

Expected: all tests pass.

**Step 5: Compile check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

**Step 6: Commit**

```bash
git add src/agents/agent-2-design/research-orchestrator.ts src/agents/agent-2-design/research-orchestrator.test.ts
git commit -m "feat(agent-2): add research orchestrator with 6 parallel subagents"
```

---

## Task 5: Update synthesis prompts to consume research

The existing prompts in `prompts.ts` currently contain no research context. Update each one to accept and embed research findings.

**Files:**
- Modify: `src/agents/agent-2-design/prompts.ts`

No tests for this task — prompt text is validated by the integration test output quality.

**Replace the entire file content** of `src/agents/agent-2-design/prompts.ts` with this:

```typescript
export interface SynthesisPromptContext {
  competitorResearch?: string | null;
  croResearch?: string | null;
  designResearch?: string | null;
  copyResearch?: string | null;
  schemaResearch?: string | null;
  seasonalResearch?: string | null;
}

function researchBlock(label: string, content: string | null | undefined): string {
  if (!content) return "";
  return `\n\n=== ${label} ===\n${content}`;
}

export function buildCompetitorAnalysisPrompt(
  niche: string,
  ctx?: SynthesisPromptContext
): string {
  const research =
    researchBlock("COMPETITOR RESEARCH", ctx?.competitorResearch) +
    researchBlock("CRO DATA", ctx?.croResearch);

  return `You are a CRO analyst specializing in local service business landing pages.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Analyze the top-performing landing page patterns for the "${niche}" niche and produce a competitor analysis.

This system is pay-per-call. Users should be pushed toward phone calls, not web forms.

${research ? "Base your analysis on the research above. Cite specific findings where relevant. Do not hallucinate data — only use what is in the research." : ""}

Focus on:
- Common page layouts and section ordering
- Trust signal placement (reviews, certifications, guarantees)
- CTA patterns (phone numbers, repeated call buttons, sticky call bars, call badges)
- Content structure (headlines, subheadlines, body copy length)
- Mobile optimization patterns
- Schema markup usage
- Social proof elements
- Differences between emergency intent, city hub intent, pest-specific intent, trust-first local authority, and qualifier patterns

Output ONLY valid JSON matching the provided schema.`;
}

export function buildDesignSpecPrompt(
  niche: string,
  competitorAnalysisJson: string,
  ctx?: SynthesisPromptContext
): string {
  const research =
    researchBlock("COMPETITOR RESEARCH", ctx?.competitorResearch) +
    researchBlock("DESIGN RESEARCH", ctx?.designResearch) +
    researchBlock("CRO DATA", ctx?.croResearch);

  return `You are a UI/UX designer specializing in high-converting local service landing pages.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Create a complete design specification for the "${niche}" niche based on this competitor analysis:
${competitorAnalysisJson}

This build is for a pay-per-call publisher. Enforce these non-negotiables:
- The primary CTA is a phone call
- No user-facing forms
- Repeat one call-focused CTA type in multiple positions
- Keep click-to-call highly visible on mobile and desktop

${research ? "Use specific data from the research above (CVR percentages, A/B test results, pixel measurements) as evidence for your design decisions. Include CSS specifications where the research provides them." : ""}

Build a structured playbook that includes:
- A selected primary archetype for "${niche}"
- A catalog of five supported archetypes with expected CVR ranges
- Complete color palette with hex codes and rationale
- Typography scale with desktop and mobile sizes
- Layout grid specification
- Responsive breakpoints
- CTA button CSS specification
- CTA placement frequency rules

Return a structured design system matching the schema exactly.

Output ONLY valid JSON matching the provided schema.`;
}

export function buildCopyFrameworkPrompt(
  niche: string,
  ctx?: SynthesisPromptContext
): string {
  const research =
    researchBlock("COPY RESEARCH", ctx?.copyResearch) +
    researchBlock("CRO DATA", ctx?.croResearch);

  return `You are a direct-response copywriter for local service businesses.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Create a copy framework for the "${niche}" niche.

${research ? "Ground every recommendation in the research above. Tag each formula as either A/B-test-proven or industry best practice. Include the % lift data where available." : ""}

Include:
1. Headline formulas (10-15) using loss aversion, authority, urgency, and benefit patterns — with examples for all four verticals (general pest, termites, bed bugs, wildlife/rodents)
2. CTA text ranked by performance (cite test data where available) — phone call CTAs only, no forms
3. CTA microcopy (3-6) for reducing hesitation beneath call buttons
4. Trust signals (6-8) with placement guidance
5. Guarantees (3-6) with specific language
6. Reading level rules (target grade level and why)
7. Vertical emotional angles — one per pest vertical
8. FAQ templates (8-10) with answers
9. PAS scripts (4-6) — one per pest vertical

Use {city}, {phone}, {service}, {pest} as placeholders.

Output ONLY valid JSON matching the provided schema.`;
}

export function buildSchemaTemplatePrompt(
  niche: string,
  ctx?: SynthesisPromptContext
): string {
  const research = researchBlock("SCHEMA RESEARCH", ctx?.schemaResearch);

  return `You are a structured data specialist for local SEO.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Create JSON-LD schema templates for the "${niche}" niche.

${research ? "Use the research above to ensure templates are spec-compliant. Follow the specific schema.org types and property patterns identified in the research." : ""}

Include complete, production-ready JSON-LD for:
1. Primary PestControlService schema — uses areaServed (NOT a street address) for rank-and-rent sites without a GBP
2. FAQPage schema — with visible-on-page requirement noted in comments
3. Service schema — one per pest vertical (general, termites, bed bugs, rodents, wildlife)
4. Review/AggregateRating schema — with note that reviewed items must be visible on page
5. BreadcrumbList schema

All templates must be valid JSON-LD and use {city}, {state}, {phone}, {business_name} as placeholders.

Output ONLY valid JSON matching the provided schema.`;
}

export function buildSeasonalCalendarPrompt(
  niche: string,
  ctx?: SynthesisPromptContext
): string {
  const research = researchBlock("SEASONAL RESEARCH", ctx?.seasonalResearch);

  return `You are a pest control industry analyst.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Create a 12-month seasonal content calendar for the "${niche}" niche.

${research ? "Use the research above to ground every month's recommendations in real pest activity data, not assumptions. Cite specific regional patterns where the research provides them." : ""}

For each month (January through December):
- Primary pests active in that period (with regional variation: Southeast, Southwest, Northeast, Midwest)
- Recommended content topics
- Messaging priorities (prevention vs treatment vs emergency)
- Seasonal keywords to target
- Marketing urgency level (low/medium/high/critical)
- Regional overrides where pest timing differs significantly by climate

This calendar guides Agent 3's content and Agent 7's seasonal performance benchmarks.

Output ONLY valid JSON matching the provided schema.`;
}

// Legacy named exports for backward compatibility during migration
// These are used by the vertical strategy system which has not been updated yet
export const COMPETITOR_ANALYSIS_PROMPT = buildCompetitorAnalysisPrompt("pest control");
export const DESIGN_SPEC_PROMPT = buildDesignSpecPrompt("pest control", "{}");
export const COPY_FRAMEWORK_PROMPT = buildCopyFrameworkPrompt("pest control");
export const SCHEMA_TEMPLATE_PROMPT = buildSchemaTemplatePrompt("pest control");
export const SEASONAL_CALENDAR_PROMPT = buildSeasonalCalendarPrompt("pest control");
```

**Compile check:**

```bash
npx tsc --noEmit
```

If the vertical strategy system imports the old named exports and fails, the backward-compat exports at the bottom handle it. Fix any remaining import errors.

**Commit:**

```bash
git add src/agents/agent-2-design/prompts.ts
git commit -m "feat(agent-2): update synthesis prompts to accept research context"
```

---

## Task 6: Wire Phase 1 into runAgent2()

Connect the research orchestrator into the existing `runAgent2()` function. Research runs first, findings pass into each synthesis call.

**Files:**
- Modify: `src/agents/agent-2-design/index.ts`

**Step 1: Add imports at the top of index.ts (after existing imports)**

```typescript
import { runResearchPhase } from "./research-orchestrator.js";
import {
  buildCompetitorAnalysisPrompt,
  buildDesignSpecPrompt,
  buildCopyFrameworkPrompt,
  buildSchemaTemplatePrompt,
  buildSeasonalCalendarPrompt,
  type SynthesisPromptContext,
} from "./prompts.js";
import { buildResearchContext } from "./research-reader.js";
import { join } from "node:path";
import { rmSync } from "node:fs";
```

**Step 2: Add research phase to runAgent2()**

In `runAgent2()`, immediately after the `config.forceRefresh` log line and before Step 1 (competitor analysis), insert:

```typescript
// Phase 1: Deep research via Agent SDK subagents
const researchDir = join("tmp", "agent2-research", config.offerProfile?.offer_id ?? cacheKey);
let researchCtx: SynthesisPromptContext = {};

if (!config.forceRefresh && checkpoints.has("research_complete")) {
  console.log("[Agent 2] Reusing checkpointed research findings");
  // Re-read existing research files
  try {
    const { runResearchPhase: _unused, ...readerModule } = await import("./research-reader.js");
    const { readResearchFile, validateResearchFile } = readerModule;
    researchCtx = {
      competitors: readResearchFile(join(researchDir, "competitors.md")),
      croData: readResearchFile(join(researchDir, "cro-data.md")),
      design: readResearchFile(join(researchDir, "design.md")),
      copy: readResearchFile(join(researchDir, "copy.md")),
      schema: readResearchFile(join(researchDir, "schema.md")),
      seasonal: readResearchFile(join(researchDir, "seasonal.md")),
    };
  } catch {
    console.warn("[Agent 2] Could not reload research files, will re-run research");
  }
} else {
  console.log("[Agent 2] Phase 1: Running deep research...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Deep research", detail: "Spawning subagents", timestamp: Date.now() });
  const findings = await runResearchPhase({ niche: config.niche, researchDir });
  researchCtx = {
    competitors: findings.competitors,
    croData: findings.croData,
    design: findings.design,
    copy: findings.copy,
    schema: findings.schema,
    seasonal: findings.seasonal,
  };
  await checkpoints.mark("research_complete", {
    competitorsWords: findings.competitors?.split(/\s+/).length ?? 0,
    croWords: findings.croData?.split(/\s+/).length ?? 0,
  });
  console.log("[Agent 2] Phase 1 complete");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Research complete", detail: "Phase 2: synthesis", timestamp: Date.now() });
}
```

**Step 3: Update each synthesis call to use research context**

Find the 5 `llm.call()` blocks in `runAgent2()` and update their `prompt:` lines:

Replace the competitor analysis prompt call:
```typescript
// BEFORE:
const competitorPrompt = strategy.getCompetitorAnalysisPrompt(config.niche, strategyContext);

// AFTER:
const competitorPrompt = buildCompetitorAnalysisPrompt(config.niche, researchCtx);
```

Replace the design spec prompt call:
```typescript
// BEFORE:
const designPrompt = strategy.getDesignSpecPrompt({ niche: config.niche, competitorAnalysisJson: ... }, strategyContext);

// AFTER:
const designPrompt = buildDesignSpecPrompt(config.niche, JSON.stringify(competitorAnalysis, null, 2), researchCtx);
```

Replace copy framework:
```typescript
// BEFORE:
const copyPrompt = strategy.getCopyFrameworkPrompt(config.niche, strategyContext);

// AFTER:
const copyPrompt = buildCopyFrameworkPrompt(config.niche, researchCtx);
```

Replace schema templates:
```typescript
// BEFORE:
const schemaPrompt = strategy.getSchemaTemplatePrompt(config.niche, strategyContext);

// AFTER:
const schemaPrompt = buildSchemaTemplatePrompt(config.niche, researchCtx);
```

Replace seasonal calendar:
```typescript
// BEFORE:
const seasonalPrompt = strategy.getSeasonalCalendarPrompt(config.niche, strategyContext);

// AFTER:
const seasonalPrompt = buildSeasonalCalendarPrompt(config.niche, researchCtx);
```

**Step 4: Add cleanup after successful completion**

At the very end of `runAgent2()`, before the final `console.log("[Agent 2] Design research complete")`:

```typescript
// Clean up research temp files after successful synthesis
try {
  rmSync(researchDir, { recursive: true, force: true });
  console.log("[Agent 2] Research temp files cleaned up");
} catch {
  // Non-fatal — temp files can linger
}
```

**Step 5: Compile check**

```bash
npx tsc --noEmit
```

Fix any type errors. Common issues:
- `strategy.getCompetitorAnalysisPrompt` may no longer be called — that's fine, the vertical strategy system still has those methods, we just no longer call them from here
- Import conflicts if `prompts.ts` still exports old constants — the backward-compat exports handle this

**Step 6: Commit**

```bash
git add src/agents/agent-2-design/index.ts
git commit -m "feat(agent-2): wire Phase 1 research into runAgent2 before synthesis"
```

---

## Task 7: Integration test — run and evaluate

This is the quality gate. Run Agent 2 for a real niche and compare the synthesis output against the target Claude.ai Research report.

**Step 1: Run Agent 2**

```bash
npm run agent:2
```

Or if Agent 2 requires config flags, check how it's called in `src/index.ts` and run with the same args used for "pest control".

Watch the logs. You should see:
```
[Agent 2] Phase 1: Running deep research...
[Agent 2][Research] Starting research phase for "pest control"
[Agent 2][Research] Spawning subagent: competitor-analyzer
[Agent 2][Research] Spawning subagent: cro-researcher
... (all 6 spawned)
[Agent 2][Research] Loaded competitors.md (XXXX words)
[Agent 2][Research] Loaded cro-data.md (XXXX words)
...
[Agent 2] Phase 1 complete
[Agent 2] Phase 2: synthesis...
... existing synthesis logs ...
[Agent 2] Design research complete
```

Expected run time: 20–35 minutes.

**Step 2: Query the DB to see output**

```bash
# Check competitor analysis
psql $DATABASE_URL -c "SELECT analysis->>'patterns' FROM competitor_analyses WHERE niche = 'pest control' LIMIT 1;" | head -50

# Check design spec
psql $DATABASE_URL -c "SELECT archetype, colors->>'cta_primary' FROM design_specs WHERE niche = 'pest control' LIMIT 1;"

# Check copy framework
psql $DATABASE_URL -c "SELECT jsonb_array_length(headlines) as headline_count, (headlines->0)::text FROM copy_frameworks WHERE niche = 'pest control';"
```

**Step 3: Evaluate against the target**

Compare the synthesis output against the Claude.ai Research report provided in the design doc. Check:

- [ ] Competitor analysis cites real site names (not fabricated)
- [ ] Design spec includes CVR percentages with evidence
- [ ] Color palette has rationale citing real research
- [ ] Copy framework tags formulas as A/B-tested vs best practice
- [ ] Schema templates are complete valid JSON-LD
- [ ] Seasonal calendar cites real pest activity data

**Step 4: If quality < 90% similar — iterate on subagent prompts**

If a specific domain is thin (e.g. CRO data is shallow), strengthen that subagent's prompt in `subagent-prompts.ts`:
- Add more specific search queries
- Tell it to drill deeper into the top results
- Increase the minimum source target

Re-run and compare. Repeat until output quality reaches the target.

**Step 5: Final commit when quality target is met**

```bash
git add -A
git commit -m "feat(agent-2): deep research rebuild complete — 500+ sources via Agent SDK subagents"
```

---

## Summary of New Files

| File | Purpose |
|---|---|
| `src/agents/agent-2-design/research-reader.ts` | Reads + validates research markdown files |
| `src/agents/agent-2-design/research-reader.test.ts` | Tests for reader |
| `src/agents/agent-2-design/subagent-prompts.ts` | 6 detailed subagent prompts |
| `src/agents/agent-2-design/research-orchestrator.ts` | Agent SDK `query()` call with 6 subagents |
| `src/agents/agent-2-design/research-orchestrator.test.ts` | Tests for orchestrator (mocked SDK) |

## Modified Files

| File | Change |
|---|---|
| `package.json` | Add `@anthropic-ai/claude-agent-sdk` |
| `src/agents/agent-2-design/prompts.ts` | Prompts now accept research context |
| `src/agents/agent-2-design/index.ts` | Phase 1 research wired in before Phase 2 synthesis |

## Unchanged (DB schemas, pipelines, downstream agents)

Everything in `src/shared/schemas/`, `src/agents/agent-3-builder/`, `src/agents/agent-7-monitor/`, `src/orchestrator/` — untouched.

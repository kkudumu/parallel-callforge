import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { runResearchPhase } from "./research-orchestrator.js";

const mockedQuery = vi.mocked(query as any);

const VALID_RESEARCH_FILE = `# Keyword Pattern Research — pest control

**Subagent:** keyword-pattern-researcher
**Sources consulted:** 42
**Date:** 2026-03-05

## Key Findings

### High-intent emergency terms dominate
**Evidence:** https://example.com/emergency-pest-keywords
**Data:** Same-day intent terms carry 2.3x higher CPC and 1.7x higher click-to-call rate in paid search benchmarks
**Implication:** Keyword templates should prioritize emergency and availability modifiers in city-level head terms

## Source Index
- https://example.com/emergency-pest-keywords — emergency keyword benchmark data
`.repeat(12);

function makeAsyncGenerator(items: any[]) {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

describe("runResearchPhase", () => {
  let researchDir: string;

  beforeEach(() => {
    researchDir = join(tmpdir(), `agent1-research-orch-${Date.now()}-${Math.random()}`);
    mkdirSync(researchDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(researchDir, { recursive: true, force: true });
  });

  it("returns findings when at least 4 files are valid", async () => {
    mockedQuery.mockImplementation(() => {
      writeFileSync(join(researchDir, "keyword-patterns.md"), VALID_RESEARCH_FILE, "utf8");
      writeFileSync(join(researchDir, "market-data.md"), VALID_RESEARCH_FILE, "utf8");
      writeFileSync(join(researchDir, "competitor-keywords.md"), VALID_RESEARCH_FILE, "utf8");
      writeFileSync(join(researchDir, "local-seo.md"), VALID_RESEARCH_FILE, "utf8");
      return makeAsyncGenerator([{ result: "ok" }]);
    });

    const findings = await runResearchPhase({
      niche: "pest control",
      researchDir,
    });

    expect(findings.keywordPatterns).toBeTruthy();
    expect(findings.marketData).toBeTruthy();
    expect(findings.competitorKeywords).toBeTruthy();
    expect(findings.localSeo).toBeTruthy();
    expect(findings.ppcEconomics).toBeNull();
    expect(findings.gbpCompetition).toBeNull();
  });

  it("throws when fewer than 4 files are valid", async () => {
    mockedQuery.mockImplementation(() => {
      writeFileSync(join(researchDir, "keyword-patterns.md"), VALID_RESEARCH_FILE, "utf8");
      writeFileSync(join(researchDir, "market-data.md"), VALID_RESEARCH_FILE, "utf8");
      writeFileSync(join(researchDir, "competitor-keywords.md"), VALID_RESEARCH_FILE, "utf8");
      return makeAsyncGenerator([{ result: "ok" }]);
    });

    await expect(
      runResearchPhase({
        niche: "pest control",
        researchDir,
      })
    ).rejects.toThrow("produced only 3/6 valid files");
  });

  it("throws when the SDK query emits an error event mid-stream", async () => {
    mockedQuery.mockImplementation(() =>
      makeAsyncGenerator([
        { message: { content: [] } },
        { is_error: true, result: "stream error" },
      ])
    );

    await expect(
      runResearchPhase({
        niche: "pest control",
        researchDir,
      })
    ).rejects.toThrow("Research phase failed");
  });
});

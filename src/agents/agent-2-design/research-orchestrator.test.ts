import { mkdirSync, writeFileSync, rmSync } from "node:fs";
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

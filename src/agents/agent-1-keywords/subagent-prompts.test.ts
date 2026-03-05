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

import { describe, it, expect } from "@jest/globals";
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

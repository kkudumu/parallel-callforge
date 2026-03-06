import { describe, it, expect } from "@jest/globals";
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

### Emergency pest control same day
**Evidence:** https://semrush.com/pest-control-keywords
**Data:** 3,400 monthly searches nationally, $62 CPC, very high intent
**Implication:** Emergency and same-day terms dominate conversion for pest control; prioritise in title tags

### Bed bug exterminator near me
**Evidence:** https://ahrefs.com/keywords/bed-bug-exterminator
**Data:** 6,600 monthly searches, $55 CPC, KD 28
**Implication:** Bed bug pages should be standalone service subpages, not combined with general pest content

### Termite inspection cost
**Evidence:** https://semrush.com/termite-keywords-report-2025
**Data:** 8,100 monthly searches, $38 CPC, informational-to-commercial transition intent
**Implication:** Cost pages rank well with transparent pricing tables; add local trust signals

### Rodent control residential pricing
**Evidence:** https://moz.com/local-seo/pest-control-intent-study
**Data:** 2,900 monthly searches, $41 CPC, high commercial intent
**Implication:** Residential-specific rodent pages outperform generic rodent pages in suburban markets with detached housing

### Mosquito treatment yard service
**Evidence:** https://ahrefs.com/keywords/mosquito-yard-treatment
**Data:** 4,200 monthly searches, seasonal peak April–September, $28 CPC
**Implication:** Mosquito service pages require seasonal content updates; push seasonal terms in Q1 to capture early intent

### Cockroach exterminator apartment
**Evidence:** https://semrush.com/roach-keywords
**Data:** 1,800 monthly searches, $33 CPC, urban market concentration
**Implication:** Apartment-focused cockroach pages target dense urban rental populations; include multi-unit language

### Ant control inside house
**Evidence:** https://ahrefs.com/keywords/indoor-ant-control
**Data:** 5,500 monthly searches, $19 CPC, low-to-medium KD
**Implication:** Indoor ant pages have lower CPC but high volume; use for top-of-funnel content with strong internal links to pricing pages

### Wasp nest removal near me
**Evidence:** https://ahrefs.com/keywords/wasp-removal
**Data:** 2,100 monthly searches, $31 CPC, strong summer seasonality May–August, low KD 18
**Implication:** Wasp and stinging insect pages spike dramatically in summer; refresh content and meta in April to capture early season intent before competitors update their pages

### Flea treatment whole house
**Evidence:** https://semrush.com/flea-keywords
**Data:** 3,800 monthly searches nationally, $24 CPC, medium KD 22, pet owner audience segment
**Implication:** Flea pages convert better when they address pet owners explicitly; include pet-safe treatment language and veterinarian trust signals to differentiate from generic pest pages

### Pest control quarterly plan
**Evidence:** https://moz.com/pest-control-recurring-revenue-study
**Data:** 1,600 monthly searches, $47 CPC, subscription and recurring intent signal
**Implication:** Recurring service plan pages have lower volume but highest lifetime value conversion; target them on standalone service pages with pricing comparison tables showing quarterly vs monthly options

### Commercial pest control quote
**Evidence:** https://ahrefs.com/keywords/commercial-pest-control
**Data:** 890 monthly searches, $78 CPC, very high commercial intent, B2B buyer audience
**Implication:** Commercial pest control keywords have dramatically higher CPCs than residential; separate commercial and residential landing pages to avoid diluting landing page relevance scores and to enable different conversion tracking for each audience

## Source Index
- https://ahrefs.com/keywords/pest-control — keyword data for pest control vertical
- https://semrush.com/pest-control-keywords — SEMrush pest control keyword database
- https://moz.com/local-seo/pest-control-intent-study — Moz intent classification study for pest control
- https://ahrefs.com/keywords/bed-bug-exterminator — bed bug keyword volume and CPC data
- https://semrush.com/termite-keywords-report-2025 — termite keyword data and intent analysis
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
    expect(ctx).toContain("**Sources consulted:** 42");
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

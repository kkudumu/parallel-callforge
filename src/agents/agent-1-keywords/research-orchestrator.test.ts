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

import { describe, it, expect } from "@jest/globals";
import { runQualityGate, BANNED_PHRASES } from "./quality-gate.js";

const FILLER_WORDS = Array.from({ length: 1300 }, (_, index) => `word${index}`).join(" ");

describe("Quality Gate", () => {
  it("passes content that meets all criteria", () => {
    const content = `${FILLER_WORDS} Santa Cruz pest control services available here. Call (831) 555-1234 for inspections. Santa Cruz homeowners call our team anytime. Santa Cruz neighborhoods need seasonal treatments. Call now for Santa Cruz service.`;
    const result = runQualityGate(content, "Santa Cruz", 1200);
    expect(result.passed).toBe(true);
  });

  it("fails content with sparse city mentions", () => {
    const content = FILLER_WORDS + " Santa Cruz pest control services available here.";
    const result = runQualityGate(content, "Santa Cruz", 1200);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("city_name_sparse");
  });

  it("fails content with banned AI phrases", () => {
    const content = "It is important to note that pest control in Santa Cruz requires attention. " + FILLER_WORDS;
    const result = runQualityGate(content, "Santa Cruz", 1200);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("banned_phrases");
  });

  it("fails content below minimum word count", () => {
    const content = "Short content about Santa Cruz pest control.";
    const result = runQualityGate(content, "Santa Cruz", 800);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("word_count");
  });

  it("fails content missing city name", () => {
    const content = FILLER_WORDS + " pest control services are available.";
    const result = runQualityGate(content, "Santa Cruz", 800);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("city_name_missing");
  });

  it("fails repetitive content with weak uniqueness", () => {
    const sentence = "Santa Cruz pest control helps homeowners stop ants and rodents fast";
    const content = Array(180).fill(sentence).join(". ") + ".";
    const result = runQualityGate(content, "Santa Cruz", 800);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("low_uniqueness");
    expect(result.failures).toContain("repeated_sentences");
  });

  it("fails content that still contains placeholder tokens", () => {
    const content = `${FILLER_WORDS} Santa Cruz pest control starts here. Call [PHONE] today for Santa Cruz service. Santa Cruz experts are ready.`;
    const result = runQualityGate(content, "Santa Cruz", 800, ["{domain}", "TODO"]);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("placeholder_tokens");
    expect(result.metrics.placeholdersFound).toEqual(expect.arrayContaining(["[PHONE]", "{domain}", "TODO"]));
  });
});

import { describe, it, expect } from "@jest/globals";
import { runQualityGate, BANNED_PHRASES } from "./quality-gate.js";

const FILLER_WORDS = Array(1300).fill("word").join(" ");

describe("Quality Gate", () => {
  it("passes content that meets all criteria", () => {
    const content = FILLER_WORDS + " Santa Cruz pest control services available here.";
    const result = runQualityGate(content, "Santa Cruz", 1200);
    expect(result.passed).toBe(true);
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
});

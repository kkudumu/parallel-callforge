/**
 * Tests for repairContentForQa correctness:
 *
 * Bug #9 (fixed): repairContentForQa must forward QA params to runQualityGate
 * Self-healing: repair prompt must contain failure-specific actionable instructions
 * so the LLM knows exactly what to fix (phone count, word count, city mentions, etc.)
 */
import { describe, it, expect } from "@jest/globals";
import { z } from "zod/v4";
import type { LlmClient, LlmCallOptions } from "../../shared/cli/llm-client.js";
import { repairContentForQa } from "./index.js";

// 500 unique words — ensures word count, uniqueness, and repeated-sentence checks pass
const FILLER = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");

// Mock LLM that always returns content with exactly 3 phone ("call") mentions.
// This satisfies default phoneMinMentions=3 but must FAIL when spec requires 4.
const mockLlm: LlmClient = {
  async call<T extends z.ZodType>(_options: LlmCallOptions<T>): Promise<z.infer<T>> {
    return {
      title: "Santa Cruz Pest Control Services",
      meta_description: "Professional pest control in Santa Cruz, CA.",
      content: [
        "Call our Santa Cruz pest control team today.",   // phone mention 1
        "Call for same-day service.",                     // phone mention 2
        "Call for a free inspection.",                    // phone mention 3
        "Santa Cruz homeowners trust our local experts.",
        "Santa Cruz properties get fast response times.",
        FILLER,
      ].join(" "),
    } as z.infer<T>;
  },
};

// Minimal valid "original content" sent to the repair prompt (not what QA runs against)
const originalContent = {
  title: "Santa Cruz Pest Control",
  meta_description: "Pest control.",
  content: "Santa Cruz pest control services. Call us now. Call today. Call for help. Santa Cruz homeowners. Santa Cruz services.",
};

describe("repairContentForQa — phoneMinMentions forwarded to runQualityGate (Bug #9)", () => {
  it("uses default phoneMinMentions=3 when option is absent — 3 mentions passes", async () => {
    const result = await repairContentForQa(mockLlm, {
      prompt: "test repair prompt",
      content: originalContent,
      city: "Santa Cruz",
      minWordCount: 100,
      supplementalTexts: [],
      failures: ["banned_phrases"],
      logLabel: "[test]",
      replacements: {},
      // phoneMinMentions not provided → default=3 applies → 3 mentions should pass
    });

    expect(result.quality.failures).not.toContain("phone_count_low");
  });

  it("phoneMinMentions=4 causes phone_count_low failure when content has only 3 mentions", async () => {
    // This test FAILS before the fix (TypeScript error: phoneMinMentions not in options type).
    // After the fix: phoneMinMentions is in the options type AND forwarded to runQualityGate,
    // so content with 3 phone mentions correctly fails repair QA when spec requires 4.
    const result = await repairContentForQa(mockLlm, {
      prompt: "test repair prompt",
      content: originalContent,
      city: "Santa Cruz",
      minWordCount: 100,
      supplementalTexts: [],
      failures: ["banned_phrases"],
      logLabel: "[test]",
      replacements: {},
      phoneMinMentions: 4,  // spec requires 4 — content has only 3 → must fail
    });

    expect(result.quality.passed).toBe(false);
    expect(result.quality.failures).toContain("phone_count_low");
    expect(result.quality.metrics.phoneMentionCount).toBe(3);
  });

  it("phoneMinMentions=2 passes when content has 3 mentions", async () => {
    const result = await repairContentForQa(mockLlm, {
      prompt: "test repair prompt",
      content: originalContent,
      city: "Santa Cruz",
      minWordCount: 100,
      supplementalTexts: [],
      failures: ["banned_phrases"],
      logLabel: "[test]",
      replacements: {},
      phoneMinMentions: 2,  // lenient spec — 3 mentions should pass
    });

    expect(result.quality.failures).not.toContain("phone_count_low");
  });
});

// ─────────────────────────────────────────────────────────────────
// Self-healing: repair prompt must give failure-specific guidance
//
// The generic prompt already mentions word count and city name, but
// it lacks actionable per-failure instructions. For a fully
// autonomous system the LLM must know exactly what to add/remove.
//
// These tests capture the prompt sent to the LLM and assert that
// the right specific instructions are present for each failure code.
// They FAIL before the fix (generic prompt has no per-failure text)
// and PASS after the fix.
// ─────────────────────────────────────────────────────────────────

function makeCaptureAndPassLlm(onPrompt: (p: string) => void): LlmClient {
  return {
    async call<T extends z.ZodType>(options: LlmCallOptions<T>): Promise<z.infer<T>> {
      onPrompt(options.prompt);
      return {
        title: "Santa Cruz Pest Control Services",
        meta_description: "Professional pest control in Santa Cruz, CA.",
        content: [
          "Call our Santa Cruz pest control team today.",
          "Call for same-day service.",
          "Call for a free inspection.",
          "Santa Cruz homeowners trust our local experts.",
          "Santa Cruz properties get fast response times.",
          FILLER,
        ].join(" "),
      } as z.infer<T>;
    },
  };
}

describe("repairContentForQa — failure-specific repair instructions (self-healing)", () => {
  it("phone_count_low: prompt tells LLM the required phone mention count", async () => {
    let captured = "";
    const llm = makeCaptureAndPassLlm((p) => { captured = p; });

    await repairContentForQa(llm, {
      prompt: "original prompt",
      content: originalContent,
      city: "Santa Cruz",
      minWordCount: 100,
      supplementalTexts: [],
      failures: ["phone_count_low"],
      logLabel: "[test]",
      replacements: {},
      phoneMinMentions: 5,
    });

    // Prompt must tell LLM what the phone minimum is so it knows how many to add
    expect(captured).toContain("5");
    expect(captured.toLowerCase()).toMatch(/phone|call.*mention|mention.*call/);
  });

  it("word_count: prompt tells LLM to expand content with specific word target", async () => {
    let captured = "";
    const llm = makeCaptureAndPassLlm((p) => { captured = p; });

    await repairContentForQa(llm, {
      prompt: "original prompt",
      content: originalContent,
      city: "Santa Cruz",
      minWordCount: 1500,
      supplementalTexts: [],
      failures: ["word_count"],
      logLabel: "[test]",
      replacements: {},
    });

    // Must explicitly say to expand / add content and quote the target word count
    expect(captured).toContain("1500");
    expect(captured.toLowerCase()).toMatch(/expand|add.*paragraph|more.*content|content.*more/);
  });

  it("city_name_sparse: prompt tells LLM the required city mention count", async () => {
    let captured = "";
    const llm = makeCaptureAndPassLlm((p) => { captured = p; });

    await repairContentForQa(llm, {
      prompt: "original prompt",
      content: originalContent,
      city: "Santa Cruz",
      minWordCount: 1000,   // ≥1000 → requiredCityMentions=4
      supplementalTexts: [],
      failures: ["city_name_sparse"],
      logLabel: "[test]",
      replacements: {},
    });

    // Must name the city and give a specific mention count target
    expect(captured).toContain("Santa Cruz");
    expect(captured.toLowerCase()).toMatch(/mention.*4|4.*mention|4.*time|at least 4/);
  });

  it("low_uniqueness: prompt tells LLM to vary vocabulary", async () => {
    let captured = "";
    const llm = makeCaptureAndPassLlm((p) => { captured = p; });

    await repairContentForQa(llm, {
      prompt: "original prompt",
      content: originalContent,
      city: "Santa Cruz",
      minWordCount: 100,
      supplementalTexts: [],
      failures: ["low_uniqueness"],
      logLabel: "[test]",
      replacements: {},
    });

    expect(captured.toLowerCase()).toMatch(/varied|vocabulary|synonym|diverse|rewrite/);
  });

  it("repeated_sentences: prompt tells LLM to rewrite duplicate sentences", async () => {
    let captured = "";
    const llm = makeCaptureAndPassLlm((p) => { captured = p; });

    await repairContentForQa(llm, {
      prompt: "original prompt",
      content: originalContent,
      city: "Santa Cruz",
      minWordCount: 100,
      supplementalTexts: [],
      failures: ["repeated_sentences"],
      logLabel: "[test]",
      replacements: {},
    });

    expect(captured.toLowerCase()).toMatch(/repeat|identical|duplicate|unique.*sentence/);
  });
});

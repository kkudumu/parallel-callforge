import { describe, it, expect } from "@jest/globals";
import { z } from "zod/v4";
import { createLlmClient } from "./llm-client.js";
import type { CliProvider } from "./types.js";
import { createRateLimiters } from "./rate-limiter.js";

function mockProvider(name: string, result: unknown, fail = false): CliProvider {
  return {
    name,
    invoke: async () => {
      if (fail) throw new Error("Provider error");
      return {
        result: JSON.stringify(result),
        is_error: false,
        raw_stdout: JSON.stringify({ result: JSON.stringify(result) }),
        raw_stderr: "",
      };
    },
  };
}

function mockRawProvider(name: string, rawResult: string): CliProvider {
  return {
    name,
    invoke: async () => ({
      result: rawResult,
      is_error: false,
      raw_stdout: JSON.stringify({ result: rawResult }),
      raw_stderr: "",
    }),
  };
}

describe("LlmClient", () => {
  const TestSchema = z.object({
    answer: z.string(),
    confidence: z.number().min(0).max(1),
  });

  it("returns validated data from primary provider", async () => {
    const primary = mockProvider("claude", { answer: "hello", confidence: 0.9 });
    const fallback = mockProvider("codex", { answer: "fallback", confidence: 0.5 });
    const limiters = createRateLimiters();
    const client = createLlmClient(primary, fallback, limiters);

    const result = await client.call({
      prompt: "test prompt",
      schema: TestSchema,
    });

    expect(result.answer).toBe("hello");
    expect(result.confidence).toBe(0.9);
  });

  it("falls back to secondary on primary failure", async () => {
    const primary = mockProvider("claude", null, true);
    const fallback = mockProvider("codex", { answer: "fallback", confidence: 0.7 });
    const limiters = createRateLimiters();
    const client = createLlmClient(primary, fallback, limiters);

    const result = await client.call({
      prompt: "test prompt",
      schema: TestSchema,
    });

    expect(result.answer).toBe("fallback");
  });

  it("falls back to tertiary on primary and secondary failure", async () => {
    const primary = mockProvider("claude", null, true);
    const fallback = mockProvider("codex", null, true);
    const tertiary = mockProvider("gemini", { answer: "tertiary", confidence: 0.6 });
    const limiters = createRateLimiters();
    const client = createLlmClient(primary, fallback, limiters, tertiary);

    const result = await client.call({
      prompt: "test prompt",
      schema: TestSchema,
    });

    expect(result.answer).toBe("tertiary");
  });

  it("accepts fenced JSON returned by a provider", async () => {
    const primary = mockRawProvider(
      "claude",
      '```json\n{"answer":"hello","confidence":0.9}\n```'
    );
    const fallback = mockProvider("codex", { answer: "fallback", confidence: 0.5 });
    const limiters = createRateLimiters();
    const client = createLlmClient(primary, fallback, limiters);

    const result = await client.call({
      prompt: "test prompt",
      schema: TestSchema,
    });

    expect(result.answer).toBe("hello");
    expect(result.confidence).toBe(0.9);
  });

  it("throws when both providers fail", async () => {
    const primary = mockProvider("claude", null, true);
    const fallback = mockProvider("codex", null, true);
    const limiters = createRateLimiters();
    const client = createLlmClient(primary, fallback, limiters);

    await expect(
      client.call({ prompt: "test", schema: TestSchema })
    ).rejects.toThrow();
  });

  it("throws when all three providers fail", async () => {
    const primary = mockProvider("claude", null, true);
    const fallback = mockProvider("codex", null, true);
    const tertiary = mockProvider("gemini", null, true);
    const limiters = createRateLimiters();
    const client = createLlmClient(primary, fallback, limiters, tertiary);

    await expect(
      client.call({ prompt: "test", schema: TestSchema })
    ).rejects.toThrow(/All providers failed/);
  });
});

import { describe, it, expect } from "@jest/globals";
import { detectRateLimit, parseRetryAfter, extractJson } from "./types.js";
import { isCodexSchemaCompatible } from "./codex-cli.js";
import { isClaudeSchemaCompatible } from "./claude-cli.js";

describe("CLI utilities", () => {
  describe("detectRateLimit", () => {
    it("detects rate limit in stderr", () => {
      expect(detectRateLimit(1, "Error: rate limit exceeded")).toBe(true);
      expect(detectRateLimit(1, "429 Too Many Requests")).toBe(true);
      expect(detectRateLimit(1, "Please try again in 30s")).toBe(true);
    });

    it("returns false for non-rate-limit errors", () => {
      expect(detectRateLimit(1, "TypeError: undefined")).toBe(false);
      expect(detectRateLimit(0, "rate limit")).toBe(false);
    });
  });

  describe("parseRetryAfter", () => {
    it("extracts retry delay from stderr", () => {
      expect(parseRetryAfter("Please try again in 30s")).toBe(31000);
      expect(parseRetryAfter("try again in 5.5 seconds")).toBe(6500);
    });

    it("defaults to 30s when no timing found", () => {
      expect(parseRetryAfter("rate limit exceeded")).toBe(30000);
    });
  });

  describe("extractJson", () => {
    it("parses raw JSON", () => {
      expect(extractJson('{"key": "value"}')).toEqual({ key: "value" });
    });

    it("extracts from markdown code block", () => {
      const input = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
      expect(extractJson(input)).toEqual({ key: "value" });
    });

    it("finds largest JSON in mixed output", () => {
      const input = 'Progress: 50%\n{"result": {"data": [1,2,3]}}\nDone.';
      expect(extractJson(input)).toEqual({ result: { data: [1, 2, 3] } });
    });

    it("throws when no JSON found", () => {
      expect(() => extractJson("no json here")).toThrow("No valid JSON");
    });
  });

  describe("isCodexSchemaCompatible", () => {
    it("accepts closed object schemas", () => {
      expect(
        isCodexSchemaCompatible({
          type: "object",
          properties: {
            value: { type: "string" },
          },
          required: ["value"],
          additionalProperties: false,
        })
      ).toBe(true);
    });

    it("rejects record-like schemas", () => {
      expect(
        isCodexSchemaCompatible({
          type: "object",
          propertyNames: { type: "string" },
          additionalProperties: { type: "string" },
        })
      ).toBe(false);
    });

    it("rejects object schemas with optional properties", () => {
      expect(
        isCodexSchemaCompatible({
          type: "object",
          properties: {
            title: { type: "string" },
            headings: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["title"],
          additionalProperties: false,
        })
      ).toBe(false);
    });
  });

  describe("isClaudeSchemaCompatible", () => {
    it("accepts simple object schemas", () => {
      expect(
        isClaudeSchemaCompatible({
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        })
      ).toBe(true);
    });

    it("rejects schemas with anyOf", () => {
      expect(
        isClaudeSchemaCompatible({
          type: "object",
          properties: {
            value: { anyOf: [{ type: "string" }, { type: "number" }] },
          },
          additionalProperties: false,
        })
      ).toBe(false);
    });

    it("rejects schemas with propertyNames", () => {
      expect(
        isClaudeSchemaCompatible({
          type: "object",
          propertyNames: { type: "string" },
          additionalProperties: {},
        })
      ).toBe(false);
    });

    it("rejects open additionalProperties", () => {
      expect(
        isClaudeSchemaCompatible({
          type: "object",
          additionalProperties: { type: "string" },
        })
      ).toBe(false);
    });

    it("accepts additionalProperties: false", () => {
      expect(
        isClaudeSchemaCompatible({
          type: "object",
          properties: { id: { type: "number" } },
          additionalProperties: false,
        })
      ).toBe(true);
    });
  });
});

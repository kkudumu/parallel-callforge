import { describe, it, expect } from "@jest/globals";
import { createRateLimiters } from "./rate-limiter.js";

describe("createRateLimiters", () => {
  it("creates limiters for claude and codex", () => {
    const limiters = createRateLimiters();
    expect(limiters.claude).toBeDefined();
    expect(limiters.codex).toBeDefined();
    expect(limiters.contentDeploy).toBeDefined();
  });

  it("limiter schedule method exists", async () => {
    const limiters = createRateLimiters();
    expect(typeof limiters.claude.schedule).toBe("function");
  });
});

import { describe, it, expect } from "vitest";
import { runAgent1, type Agent1Config } from "./index.js";

// Smoke test: verify Agent1Config accepts researchEnabled flag and runId
describe("Agent1Config interface", () => {
  it("accepts researchEnabled and runId fields", () => {
    const config: Agent1Config = {
      niche: "pest control",
      runId: "test-run",
      researchEnabled: false,
      candidateCities: [{ city: "Test", state: "TX", population: 100000 }],
    };
    expect(config.researchEnabled).toBe(false);
    expect(config.runId).toBe("test-run");
  });
});

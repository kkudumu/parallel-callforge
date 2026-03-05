import { describe, it, expect } from "vitest";
import { runAgent1, type Agent1Config } from "./index.js";

// Smoke test: verify Agent1Config accepts researchEnabled flag and runId
describe("Agent1Config interface", () => {
  it("accepts research config fields", () => {
    const config: Agent1Config = {
      niche: "pest control",
      runId: "test-run",
      researchEnabled: false,
      minValidResearchFiles: 4,
      cleanupResearchDir: true,
      candidateCities: [{ city: "Test", state: "TX", population: 100000 }],
    };
    expect(config.researchEnabled).toBe(false);
    expect(config.runId).toBe("test-run");
    expect(config.minValidResearchFiles).toBe(4);
    expect(config.cleanupResearchDir).toBe(true);
  });
});

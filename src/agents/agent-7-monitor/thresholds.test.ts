import { describe, it, expect } from "@jest/globals";
import { evaluateThresholds, type ThresholdResult } from "./thresholds.js";

describe("evaluateThresholds", () => {
  it("returns 'good' for healthy metrics", () => {
    const result = evaluateThresholds({
      bounceRate: 0.35,
      clickToCallRate: 0.10,
      callQualificationRate: 0.60,
      avgSessionDuration: 150,
    });
    expect(result.bounceRate.severity).toBe("good");
    expect(result.clickToCallRate.severity).toBe("good");
  });

  it("returns 'warning' for borderline metrics", () => {
    const result = evaluateThresholds({
      bounceRate: 0.50,
      clickToCallRate: 0.06,
      callQualificationRate: 0.45,
      avgSessionDuration: 80,
    });
    expect(result.bounceRate.severity).toBe("warning");
    expect(result.clickToCallRate.severity).toBe("warning");
  });

  it("returns 'critical' for bad metrics", () => {
    const result = evaluateThresholds({
      bounceRate: 0.70,
      clickToCallRate: 0.02,
      callQualificationRate: 0.25,
      avgSessionDuration: 20,
    });
    expect(result.bounceRate.severity).toBe("critical");
    expect(result.clickToCallRate.severity).toBe("critical");
  });
});

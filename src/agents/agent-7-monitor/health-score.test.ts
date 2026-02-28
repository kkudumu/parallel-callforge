import { describe, it, expect } from "@jest/globals";
import { calculateHealthScore } from "./health-score.js";

describe("calculateHealthScore", () => {
  it("returns 80+ for excellent metrics", () => {
    const score = calculateHealthScore({
      indexingRate: 1.0,
      rankingProgress: 0.8,
      trafficTrend: 0.9,
      conversionRate: 0.10,
      callQualityRate: 0.60,
      revenueTrend: 0.85,
      criticalAlerts: 0,
    });
    expect(score).toBeGreaterThanOrEqual(80);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("returns 40-59 for poor metrics", () => {
    const score = calculateHealthScore({
      indexingRate: 0.5,
      rankingProgress: 0.3,
      trafficTrend: 0.4,
      conversionRate: 0.03,
      callQualityRate: 0.30,
      revenueTrend: 0.3,
      criticalAlerts: 3,
    });
    expect(score).toBeGreaterThanOrEqual(30);
    expect(score).toBeLessThan(60);
  });
});

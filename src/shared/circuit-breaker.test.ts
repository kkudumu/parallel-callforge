import { describe, it, expect } from "@jest/globals";
import { createCircuitBreaker } from "./circuit-breaker.js";

describe("createCircuitBreaker", () => {
  it("creates a circuit breaker that calls the wrapped function", async () => {
    const fn = async (x: number) => x * 2;
    const breaker = createCircuitBreaker(fn, "test");
    const result = await breaker.fire(5);
    expect(result).toBe(10);
  });

  it("opens after consecutive failures", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error("fail");
    };
    const breaker = createCircuitBreaker(fn, "test-fail", {
      volumeThreshold: 2,
      errorThresholdPercentage: 50,
      resetTimeout: 100,
    });

    for (let i = 0; i < 3; i++) {
      try { await breaker.fire(); } catch { /* expected */ }
    }

    expect(breaker.opened).toBe(true);
  });
});

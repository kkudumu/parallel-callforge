import CircuitBreaker from "opossum";
import { CIRCUIT_BREAKER_OPTIONS } from "../config/rate-limits.js";

export function createCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  name: string,
  overrides?: Partial<typeof CIRCUIT_BREAKER_OPTIONS>
): CircuitBreaker<Parameters<T>, Awaited<ReturnType<T>>> {
  const options = { ...CIRCUIT_BREAKER_OPTIONS, ...overrides, name };
  const breaker = new CircuitBreaker(fn, options);

  breaker.on("open", () => {
    console.warn(`Circuit breaker [${name}] OPENED - requests will be rejected`);
  });

  breaker.on("halfOpen", () => {
    console.log(`Circuit breaker [${name}] HALF-OPEN - testing recovery`);
  });

  breaker.on("close", () => {
    console.log(`Circuit breaker [${name}] CLOSED - recovered`);
  });

  return breaker;
}

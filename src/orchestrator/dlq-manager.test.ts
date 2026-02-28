import { describe, it, expect } from "@jest/globals";
import { computeFingerprint, classifyError } from "./dlq-manager.js";

describe("DLQ Manager", () => {
  describe("computeFingerprint", () => {
    it("generates consistent fingerprints for same input", () => {
      const fp1 = computeFingerprint("keyword_research", "agent-1", { city: "Phoenix" });
      const fp2 = computeFingerprint("keyword_research", "agent-1", { city: "Phoenix" });
      expect(fp1).toBe(fp2);
      expect(fp1.length).toBe(16);
    });

    it("generates different fingerprints for different input", () => {
      const fp1 = computeFingerprint("keyword_research", "agent-1", { city: "Phoenix" });
      const fp2 = computeFingerprint("keyword_research", "agent-1", { city: "Atlanta" });
      expect(fp1).not.toBe(fp2);
    });
  });

  describe("classifyError", () => {
    it("classifies rate limit as transient", () => {
      expect(classifyError(new Error("rate limit exceeded"))).toBe("transient");
      expect(classifyError(new Error("429 Too Many Requests"))).toBe("transient");
    });

    it("classifies timeout as transient", () => {
      expect(classifyError(new Error("ETIMEDOUT"))).toBe("transient");
      expect(classifyError(new Error("socket hang up"))).toBe("transient");
    });

    it("classifies validation errors as permanent", () => {
      expect(classifyError(new Error("ZodError: invalid type"))).toBe("permanent");
    });

    it("classifies unknown errors as unknown", () => {
      expect(classifyError(new Error("something weird"))).toBe("unknown");
    });
  });
});

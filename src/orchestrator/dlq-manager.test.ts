import { describe, it, expect } from "@jest/globals";
import {
  computeFingerprint,
  classifyError,
  TRANSIENT_COOLDOWN_MS,
  UNKNOWN_COOLDOWN_MS,
  createDlqManager,
} from "./dlq-manager.js";

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

  describe("isInDLQ error-class awareness", () => {
    function createMockDb(rows: any[] = []) {
      const queries: Array<{ text: string; params: any[] }> = [];
      return {
        db: {
          query: async (text: string, params: any[] = []) => {
            queries.push({ text, params });
            // Return rows only for SELECT queries
            if (text.trim().toUpperCase().startsWith("SELECT")) {
              return { rows, rowCount: rows.length };
            }
            return { rows: [], rowCount: 0 };
          },
          end: async () => {},
        },
        queries,
      };
    }

    it("returns false when no DLQ entry exists", async () => {
      const { db } = createMockDb([]);
      const dlq = createDlqManager(db as any);
      expect(await dlq.isInDLQ("test", "agent-1", { x: 1 })).toBe(false);
    });

    it("returns true for permanent errors", async () => {
      const { db } = createMockDb([{
        id: "abc",
        error_class: "permanent",
        retry_count: 1,
        max_retries: 3,
        last_failed_at: new Date(),
      }]);
      const dlq = createDlqManager(db as any);
      expect(await dlq.isInDLQ("test", "agent-1", { x: 1 })).toBe(true);
    });

    it("returns true for transient errors within cooldown", async () => {
      const { db } = createMockDb([{
        id: "abc",
        error_class: "transient",
        retry_count: 1,
        max_retries: 3,
        last_failed_at: new Date(), // just now
      }]);
      const dlq = createDlqManager(db as any);
      expect(await dlq.isInDLQ("test", "agent-1", { x: 1 })).toBe(true);
    });

    it("auto-resolves transient errors after cooldown", async () => {
      const pastDate = new Date(Date.now() - TRANSIENT_COOLDOWN_MS - 1000);
      const { db, queries } = createMockDb([{
        id: "abc",
        error_class: "transient",
        retry_count: 1,
        max_retries: 3,
        last_failed_at: pastDate,
      }]);
      const dlq = createDlqManager(db as any);
      expect(await dlq.isInDLQ("test", "agent-1", { x: 1 })).toBe(false);
      // Verify it issued an UPDATE to resolve the entry
      const updateQuery = queries.find((q) => q.text.includes("resolved_at = now()"));
      expect(updateQuery).toBeDefined();
      expect(updateQuery!.params).toEqual(["abc"]);
    });

    it("auto-resolves unknown errors after longer cooldown", async () => {
      const pastDate = new Date(Date.now() - UNKNOWN_COOLDOWN_MS - 1000);
      const { db } = createMockDb([{
        id: "abc",
        error_class: "unknown",
        retry_count: 3,
        max_retries: 3,
        last_failed_at: pastDate,
      }]);
      const dlq = createDlqManager(db as any);
      expect(await dlq.isInDLQ("test", "agent-1", { x: 1 })).toBe(false);
    });

    it("blocks unknown errors within cooldown", async () => {
      const { db } = createMockDb([{
        id: "abc",
        error_class: "unknown",
        retry_count: 1,
        max_retries: 3,
        last_failed_at: new Date(),
      }]);
      const dlq = createDlqManager(db as any);
      expect(await dlq.isInDLQ("test", "agent-1", { x: 1 })).toBe(true);
    });
  });

  describe("resolveByTask", () => {
    function createMockDb() {
      const queries: Array<{ text: string; params: any[] }> = [];
      return {
        db: {
          query: async (text: string, params: any[] = []) => {
            queries.push({ text, params });
            return { rows: [], rowCount: 0 };
          },
          end: async () => {},
        },
        queries,
      };
    }

    it("resolves unresolved DLQ entries matching task fingerprint", async () => {
      const { db, queries } = createMockDb();
      const dlq = createDlqManager(db as any);
      await dlq.resolveByTask("keyword_research", "agent-1", { niche: "pest-control" });

      const updateQuery = queries.find((q) => q.text.includes("resolution = 'retried'"));
      expect(updateQuery).toBeDefined();
      // Should use the correct fingerprint
      const fp = computeFingerprint("keyword_research", "agent-1", { niche: "pest-control" });
      expect(updateQuery!.params[0]).toBe(fp);
    });
  });

  describe("cooldown constants", () => {
    it("transient cooldown is 5 minutes", () => {
      expect(TRANSIENT_COOLDOWN_MS).toBe(5 * 60 * 1000);
    });

    it("unknown cooldown is 10 minutes", () => {
      expect(UNKNOWN_COOLDOWN_MS).toBe(10 * 60 * 1000);
    });
  });
});

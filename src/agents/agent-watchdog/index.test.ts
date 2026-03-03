import { clusterFailurePatterns, clusterSuccessPatterns, runWatchdogTick } from "./index.js";
import type { RunLogRow } from "./index.js";

describe("clusterFailurePatterns", () => {
  it("groups rows with similar error messages by agent+step+signature", () => {
    const rows: RunLogRow[] = [
      { agent_name: "agent-3", step: "hugo_templates", status: "failed",
        error_message: 'partial "schema.json" not found', duration_ms: 100, model_used: null },
      { agent_name: "agent-3", step: "hugo_templates", status: "failed",
        error_message: 'partial "schema.html" not found', duration_ms: 120, model_used: null },
      { agent_name: "agent-3", step: "hugo_templates", status: "failed",
        error_message: 'partial "json-ld.html" not found', duration_ms: 110, model_used: null },
    ];
    const clusters = clusterFailurePatterns(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].occurrenceCount).toBe(3);
    expect(clusters[0].agentName).toBe("agent-3");
    expect(clusters[0].step).toBe("hugo_templates");
  });

  it("keeps distinct error signatures separate", () => {
    const rows: RunLogRow[] = [
      { agent_name: "agent-3", step: "hugo_templates", status: "failed",
        error_message: 'partial "schema.json" not found', duration_ms: 100, model_used: null },
      { agent_name: "agent-3", step: "hugo_templates", status: "failed",
        error_message: "nil pointer dereference in template", duration_ms: 120, model_used: null },
      { agent_name: "agent-3", step: "hugo_templates", status: "failed",
        error_message: "nil pointer dereference in renderer", duration_ms: 110, model_used: null },
    ];
    const clusters = clusterFailurePatterns(rows);
    // "partial * not found" is one cluster (1 occurrence → filtered out)
    // "nil pointer dereference in *" is another cluster (2 occurrences → kept)
    const filtered = clusters.filter(c => c.occurrenceCount >= 2);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].errorSignature).toContain("nil pointer");
  });

  it("returns empty array when no failures", () => {
    const rows: RunLogRow[] = [
      { agent_name: "agent-1", step: "keyword_cluster", status: "success", duration_ms: 100, model_used: "claude" },
    ];
    expect(clusterFailurePatterns(rows)).toHaveLength(0);
  });
});

describe("clusterSuccessPatterns", () => {
  it("groups consistent fast paths by agent+step+model", () => {
    const rows: RunLogRow[] = [
      { agent_name: "agent-1", step: "keyword_cluster", status: "success", duration_ms: 15000, model_used: "claude" },
      { agent_name: "agent-1", step: "keyword_cluster", status: "success", duration_ms: 18000, model_used: "claude" },
      { agent_name: "agent-1", step: "keyword_cluster", status: "success", duration_ms: 14000, model_used: "claude" },
    ];
    const clusters = clusterSuccessPatterns(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].occurrenceCount).toBe(3);
    expect(clusters[0].avgDurationMs).toBeLessThan(20000);
    expect(clusters[0].agentName).toBe("agent-1");
  });

  it("requires 3+ occurrences to form a cluster", () => {
    const rows: RunLogRow[] = [
      { agent_name: "agent-1", step: "keyword_cluster", status: "success", duration_ms: 15000, model_used: "claude" },
      { agent_name: "agent-1", step: "keyword_cluster", status: "success", duration_ms: 18000, model_used: "claude" },
    ];
    expect(clusterSuccessPatterns(rows)).toHaveLength(0);
  });
});

describe("runWatchdogTick", () => {
  it("upserts failure clusters to learned_repair_patterns", async () => {
    const mockRows: RunLogRow[] = [
      { agent_name: "agent-3", step: "hugo_templates", status: "failed",
        error_message: 'partial "schema.json" not found', duration_ms: 100, model_used: null },
      { agent_name: "agent-3", step: "hugo_templates", status: "failed",
        error_message: 'partial "schema.html" not found', duration_ms: 120, model_used: null },
    ];
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: mockRows })  // fetchUnanalyzedRows
        .mockResolvedValue({ rows: [] }),            // upserts
    } as any;

    await runWatchdogTick(db);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO learned_repair_patterns"),
      expect.arrayContaining(["failure_pattern", "agent-3", "hugo_templates"])
    );
  });

  it("does nothing when no rows returned", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as any;

    await runWatchdogTick(db);

    expect(db.query).toHaveBeenCalledTimes(1); // only the SELECT, no inserts
  });
});

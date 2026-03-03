import { withSelfHealing, SelfHealingOptions } from "./self-healing.js";
import type { DbClient } from "./db/client.js";
import type { LlmClient, LlmCallOptions } from "./cli/llm-client.js";
import type { z } from "zod/v4";

// ---- minimal mock factories ------------------------------------------------

function makeMockDb(): jest.Mocked<Pick<DbClient, "query" | "end">> {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockLlm(fixedCode = "fixed_code_here"): jest.Mocked<LlmClient> {
  return {
    call: jest.fn().mockResolvedValue({ fixed_code: fixedCode, summary: "fixed" }),
  };
}

// ---- helper to build minimal opts ------------------------------------------

function makeOpts<T>(
  overrides: Partial<SelfHealingOptions<T>> & {
    fn: () => Promise<T>;
    db?: ReturnType<typeof makeMockDb>;
    llm?: jest.Mocked<LlmClient>;
  }
): SelfHealingOptions<T> & {
  db: ReturnType<typeof makeMockDb>;
  llm: jest.Mocked<LlmClient>;
} {
  const db = overrides.db ?? makeMockDb();
  const llm = overrides.llm ?? makeMockLlm();
  return {
    runId: "run-1",
    offerId: "offer-1",
    agentName: "test-agent",
    step: "test-step",
    fn: overrides.fn,
    getRepairContext: overrides.getRepairContext ?? ((err) => `Error: ${err.message}`),
    applyFix: overrides.applyFix ?? jest.fn().mockResolvedValue(undefined),
    db,
    llm,
    maxRetries: overrides.maxRetries ?? 3,
    ...(overrides.takeSnapshot !== undefined && { takeSnapshot: overrides.takeSnapshot }),
    ...(overrides.restoreSnapshot !== undefined && { restoreSnapshot: overrides.restoreSnapshot }),
    city: overrides.city,
    state: overrides.state,
  } as SelfHealingOptions<T> & { db: ReturnType<typeof makeMockDb>; llm: jest.Mocked<LlmClient> };
}

// ---- tests -----------------------------------------------------------------

describe("withSelfHealing", () => {
  it("returns fn result on success without touching llm", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const llm = makeMockLlm();
    const opts = makeOpts<string>({ fn, llm });

    const result = await withSelfHealing(opts);

    expect(result).toBe("ok");
    expect(llm.call).not.toHaveBeenCalled();
  });

  it("logs success to pipeline_run_log on first-try success", async () => {
    const fn = jest.fn().mockResolvedValue(42);
    const db = makeMockDb();
    const opts = makeOpts<number>({ fn, db });

    await withSelfHealing(opts);

    // db.query must have been called with INSERT and status='success'
    expect(db.query).toHaveBeenCalled();
    const [sql, params] = (db.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("INSERT INTO pipeline_run_log");
    // status is the 7th positional param ($7)
    expect(params[6]).toBe("success");
  });

  it("invokes llm and retries on failure, logs recovered", async () => {
    const error = new Error("first-attempt-error");
    const fn = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("recovered-value");

    const applyFix = jest.fn().mockResolvedValue(undefined);
    const llm = makeMockLlm("patched_code");
    const db = makeMockDb();

    const opts = makeOpts<string>({ fn, applyFix, llm, db });
    const result = await withSelfHealing(opts);

    expect(result).toBe("recovered-value");

    // LLM must have been called once to repair
    expect(llm.call).toHaveBeenCalledTimes(1);
    const llmCallArg = (llm.call as jest.Mock).mock.calls[0][0] as LlmCallOptions<any>;
    expect(llmCallArg.prompt).toContain("Error: first-attempt-error");

    // applyFix must have been called with the LLM-provided fixed_code
    expect(applyFix).toHaveBeenCalledWith("patched_code", 0);

    // db INSERT must log status='recovered'
    expect(db.query).toHaveBeenCalled();
    const [sql, params] = (db.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("INSERT INTO pipeline_run_log");
    expect(params[6]).toBe("recovered");
  });

  it("restores snapshot and logs dead after maxRetries failures", async () => {
    const error = new Error("persistent-error");
    const fn = jest.fn().mockRejectedValue(error);
    const db = makeMockDb();
    const llm = makeMockLlm();
    const snapshot = { data: "snapshot-data" };
    const takeSnapshot = jest.fn().mockResolvedValue(snapshot);
    const restoreSnapshot = jest.fn().mockResolvedValue(undefined);

    const opts = makeOpts<string>({
      fn,
      db,
      llm,
      takeSnapshot,
      restoreSnapshot,
      maxRetries: 2,
    });

    await expect(withSelfHealing(opts)).rejects.toThrow("persistent-error");

    // restoreSnapshot must have been called with the captured snapshot
    expect(restoreSnapshot).toHaveBeenCalledWith(snapshot);

    // db INSERT must log status='dead'
    expect(db.query).toHaveBeenCalled();
    const [sql, params] = (db.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("INSERT INTO pipeline_run_log");
    expect(params[6]).toBe("dead");
  });
});

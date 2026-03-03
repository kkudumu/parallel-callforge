import { z } from "zod/v4";
import type { DbClient } from "./db/client.js";
import type { LlmClient } from "./cli/llm-client.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface SelfHealingOptions<T> {
  runId: string;
  offerId: string;
  agentName: string;
  step: string;
  city?: string;
  state?: string;
  /** The operation to attempt and, on failure, repair. */
  fn: () => Promise<T>;
  /**
   * Build the repair prompt sent to the LLM.
   * Receives the caught error; should include both the error message
   * and the relevant broken code so the LLM can produce a fix.
   */
  getRepairContext: (error: Error) => string;
  /**
   * Apply the LLM-generated fix before the next retry.
   * @param fixedCode  The repaired source code returned by the LLM.
   * @param attempt    Zero-based index of the attempt that just failed.
   */
  applyFix: (fixedCode: string, attempt: number) => Promise<void>;
  /** Capture state before the first fn() call so it can be rolled back. */
  takeSnapshot?: () => Promise<unknown>;
  /** Roll back to the pre-fn() snapshot when all retries are exhausted. */
  restoreSnapshot?: (snapshot: unknown) => Promise<void>;
  db: DbClient;
  llm: LlmClient;
  /** Maximum number of attempts (default 3). */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Zod schema used by the LLM repair call
// ---------------------------------------------------------------------------

const RepairSchema = z.object({
  fixed_code: z.string(),
  summary: z.string(),
});

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Execute `opts.fn()` with automatic LLM-driven self-healing on failure.
 *
 * On success  → INSERTs a 'success' (first try) or 'recovered' (after repair) row.
 * On dead     → Restores snapshot (if provided), INSERTs a 'dead' row, re-throws.
 */
export async function withSelfHealing<T>(opts: SelfHealingOptions<T>): Promise<T> {
  const {
    runId,
    offerId,
    agentName,
    step,
    city,
    state,
    fn,
    getRepairContext,
    applyFix,
    takeSnapshot,
    restoreSnapshot,
    db,
    llm,
    maxRetries = 3,
  } = opts;

  // Capture snapshot before any attempt so we can roll back on dead.
  let snapshot: unknown;
  if (takeSnapshot) {
    snapshot = await takeSnapshot();
  }

  const startedAt = Date.now();
  let lastError: Error = new Error("Unknown error");
  let lastFixSummary: string | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const attemptStart = Date.now();

    try {
      const result = await fn();

      const durationMs = Date.now() - startedAt;
      const status: string = attempt === 0 ? "success" : "recovered";

      await insertLog(db, {
        runId,
        offerId,
        agentName,
        step,
        city,
        state,
        status,
        modelUsed: null,
        durationMs,
        errorMessage: null,
        fixApplied: lastFixSummary ?? null,
        retryCount: attempt,
      });

      return result;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // If we still have retries left, ask the LLM to repair the code.
      if (attempt < maxRetries - 1) {
        const repairContext = getRepairContext(lastError);
        const prompt = `${repairContext}\n\nReturn JSON with fixed_code and summary.`;

        const repair = await llm.call({ prompt, schema: RepairSchema });
        lastFixSummary = repair.summary;

        await applyFix(repair.fixed_code, attempt);
        // Loop continues → next attempt uses the patched code.
      }
    }
  }

  // All attempts exhausted — restore snapshot and log dead.
  if (restoreSnapshot) {
    await restoreSnapshot(snapshot);
  }

  const durationMs = Date.now() - startedAt;

  await insertLog(db, {
    runId,
    offerId,
    agentName,
    step,
    city,
    state,
    status: "dead",
    modelUsed: null,
    durationMs,
    errorMessage: lastError.message,
    fixApplied: lastFixSummary ?? null,
    retryCount: maxRetries - 1,
  });

  throw lastError;
}

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

interface LogRow {
  runId: string;
  offerId: string;
  agentName: string;
  step: string;
  city?: string;
  state?: string;
  status: string;
  modelUsed: string | null;
  durationMs: number;
  errorMessage: string | null;
  fixApplied: string | null;
  retryCount: number;
}

async function insertLog(db: DbClient, row: LogRow): Promise<void> {
  await db.query(
    `INSERT INTO pipeline_run_log
       (run_id, offer_id, agent_name, step, city, state, status, model_used,
        duration_ms, error_message, fix_applied, retry_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      row.runId,        // $1
      row.offerId,      // $2
      row.agentName,    // $3
      row.step,         // $4
      row.city ?? null, // $5
      row.state ?? null,// $6
      row.status,       // $7
      row.modelUsed,    // $8
      row.durationMs,   // $9
      row.errorMessage, // $10
      row.fixApplied,   // $11
      row.retryCount,   // $12
    ]
  );
}

import { createHash } from "node:crypto";
import type { DbClient } from "../shared/db/client.js";

export type ErrorClass = "transient" | "permanent" | "unknown";

export function computeFingerprint(
  taskType: string,
  agentName: string,
  payload: Record<string, unknown>
): string {
  const input = taskType + agentName + JSON.stringify(payload);
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function classifyError(error: Error): ErrorClass {
  const msg = error.message.toLowerCase();

  const transientPatterns = [
    /rate.?limit/,
    /429/,
    /too many requests/,
    /etimedout/,
    /econnreset/,
    /econnrefused/,
    /socket hang up/,
    /timeout/,
    /temporarily unavailable/,
  ];

  const permanentPatterns = [
    /zoderror/i,
    /invalid.?type/,
    /validation.?fail/,
    /schema.?mismatch/,
    /permission.?denied/,
    /not.?found.*file/,
  ];

  if (transientPatterns.some((p) => p.test(msg))) return "transient";
  if (permanentPatterns.some((p) => p.test(msg))) return "permanent";
  return "unknown";
}

export interface DlqManager {
  isInDLQ(taskType: string, agentName: string, payload: Record<string, unknown>): Promise<boolean>;
  addToDLQ(params: {
    originalTaskId: string;
    taskType: string;
    agentName: string;
    payload: Record<string, unknown>;
    error: Error;
    retryCount: number;
  }): Promise<void>;
  getUnresolved(): Promise<Array<{
    id: string;
    task_type: string;
    agent_name: string;
    error_class: ErrorClass;
    retry_count: number;
    last_failed_at: Date;
  }>>;
  resolve(id: string, resolution: "retried" | "skipped" | "manual" | "expired"): Promise<void>;
}

export function createDlqManager(db: DbClient): DlqManager {
  return {
    async isInDLQ(taskType, agentName, payload) {
      const fp = computeFingerprint(taskType, agentName, payload);
      const result = await db.query(
        "SELECT id FROM dead_letter_queue WHERE fingerprint = $1 AND resolved_at IS NULL LIMIT 1",
        [fp]
      );
      return result.rows.length > 0;
    },

    async addToDLQ({ originalTaskId, taskType, agentName, payload, error, retryCount }) {
      const fp = computeFingerprint(taskType, agentName, payload);
      const errorClass = classifyError(error);

      const existing = await db.query(
        "SELECT id, retry_count FROM dead_letter_queue WHERE fingerprint = $1 AND resolved_at IS NULL LIMIT 1",
        [fp]
      );

      if (existing.rows.length > 0) {
        await db.query(
          `UPDATE dead_letter_queue
           SET retry_count = $1, last_failed_at = now(), error_message = $2, error_stack = $3
           WHERE id = $4`,
          [retryCount, error.message, error.stack ?? null, existing.rows[0].id]
        );
      } else {
        await db.query(
          `INSERT INTO dead_letter_queue
           (original_task_id, task_type, agent_name, payload, error_message, error_stack, error_class, retry_count, fingerprint)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            originalTaskId,
            taskType,
            agentName,
            JSON.stringify(payload),
            error.message,
            error.stack ?? null,
            errorClass,
            retryCount,
            fp,
          ]
        );
      }
    },

    async getUnresolved() {
      const result = await db.query(
        `SELECT id, task_type, agent_name, error_class, retry_count, last_failed_at
         FROM dead_letter_queue
         WHERE resolved_at IS NULL
         ORDER BY last_failed_at DESC`
      );
      return result.rows;
    },

    async resolve(id, resolution) {
      await db.query(
        "UPDATE dead_letter_queue SET resolved_at = now(), resolution = $1 WHERE id = $2",
        [resolution, id]
      );
    },
  };
}

import { createHash } from "node:crypto";
import type { DbClient } from "./db/client.js";

type CheckpointPayload = Record<string, unknown>;

interface StoredCheckpointRow {
  checkpoint_key: string;
  payload: CheckpointPayload;
}

export interface CheckpointTracker {
  has(checkpointKey: string): boolean;
  get<T extends CheckpointPayload = CheckpointPayload>(checkpointKey: string): T | undefined;
  mark(checkpointKey: string, payload?: CheckpointPayload): Promise<void>;
  clear(): Promise<void>;
}

export function buildCheckpointScope(parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex");
}

export async function createCheckpointTracker(
  db: DbClient,
  agentName: string,
  scopeKey: string,
  options?: { reset?: boolean }
): Promise<CheckpointTracker> {
  if (options?.reset) {
    await db.query(
      "DELETE FROM agent_checkpoints WHERE agent_name = $1 AND scope_key = $2",
      [agentName, scopeKey]
    );
  }

  const checkpoints = new Map<string, CheckpointPayload>();
  const existing = await db.query<StoredCheckpointRow>(
    `SELECT checkpoint_key, payload
     FROM agent_checkpoints
     WHERE agent_name = $1
       AND scope_key = $2`,
    [agentName, scopeKey]
  );

  for (const row of existing.rows) {
    checkpoints.set(row.checkpoint_key, row.payload ?? {});
  }

  return {
    has(checkpointKey: string): boolean {
      return checkpoints.has(checkpointKey);
    },
    get<T extends CheckpointPayload = CheckpointPayload>(checkpointKey: string): T | undefined {
      return checkpoints.get(checkpointKey) as T | undefined;
    },
    async mark(checkpointKey: string, payload: CheckpointPayload = {}): Promise<void> {
      checkpoints.set(checkpointKey, payload);
      await db.query(
        `INSERT INTO agent_checkpoints (agent_name, scope_key, checkpoint_key, payload, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (agent_name, scope_key, checkpoint_key) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = now()`,
        [agentName, scopeKey, checkpointKey, JSON.stringify(payload)]
      );
    },
    async clear(): Promise<void> {
      checkpoints.clear();
      await db.query(
        "DELETE FROM agent_checkpoints WHERE agent_name = $1 AND scope_key = $2",
        [agentName, scopeKey]
      );
    },
  };
}

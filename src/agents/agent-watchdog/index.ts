import type { DbClient } from "../../shared/db/client.js";

export interface RunLogRow {
  agent_name: string;
  step: string;
  status: string;
  error_message: string | null;
  duration_ms: number;
  model_used: string | null;
  city?: string | null;
  state?: string | null;
}

export interface FailureCluster {
  agentName: string;
  step: string;
  errorSignature: string;
  occurrenceCount: number;
  sampleMessages: string[];
}

export interface SuccessCluster {
  agentName: string;
  step: string;
  modelUsed: string;
  occurrenceCount: number;
  avgDurationMs: number;
}

/**
 * Normalize variable parts of an error message so similar errors
 * cluster together under the same signature.
 */
function extractErrorSignature(message: string): string {
  return message
    .replace(/"[^"]+"/g, '"*"')              // quoted strings → "*"
    .replace(/\b\d+\b/g, "N")               // numbers → N
    .replace(/[A-Z]:[/\\][^\s]+/g, "PATH")  // Windows-style file paths → PATH
    .replace(/\b(in|at|for|from)\s+\w+$/i, "$1 *")  // trailing "in <identifier>" → "in *"
    .slice(0, 120);
}

/**
 * Group failure rows by agent+step+errorSignature.
 * Only returns clusters with 2 or more occurrences.
 */
export function clusterFailurePatterns(rows: RunLogRow[]): FailureCluster[] {
  const failureRows = rows.filter(
    r => r.status === "failed" || r.status === "dead"
  );

  const groups = new Map<string, { agentName: string; step: string; errorSignature: string; messages: string[] }>();

  for (const row of failureRows) {
    const msg = row.error_message ?? "";
    const sig = extractErrorSignature(msg);
    const key = `${row.agent_name}|${row.step}|${sig}`;

    if (!groups.has(key)) {
      groups.set(key, {
        agentName: row.agent_name,
        step: row.step,
        errorSignature: sig,
        messages: [],
      });
    }
    groups.get(key)!.messages.push(msg);
  }

  const clusters: FailureCluster[] = [];
  for (const group of groups.values()) {
    if (group.messages.length >= 2) {
      clusters.push({
        agentName: group.agentName,
        step: group.step,
        errorSignature: group.errorSignature,
        occurrenceCount: group.messages.length,
        sampleMessages: group.messages.slice(0, 5),
      });
    }
  }

  return clusters;
}

/**
 * Group success rows by agent+step+model.
 * Only returns clusters with 3 or more occurrences, with an average duration.
 */
export function clusterSuccessPatterns(rows: RunLogRow[]): SuccessCluster[] {
  const successRows = rows.filter(r => r.status === "success");

  const groups = new Map<string, { agentName: string; step: string; modelUsed: string; durations: number[] }>();

  for (const row of successRows) {
    const modelUsed = row.model_used ?? "unknown";
    const key = `${row.agent_name}|${row.step}|${modelUsed}`;

    if (!groups.has(key)) {
      groups.set(key, {
        agentName: row.agent_name,
        step: row.step,
        modelUsed,
        durations: [],
      });
    }
    groups.get(key)!.durations.push(row.duration_ms);
  }

  const clusters: SuccessCluster[] = [];
  for (const group of groups.values()) {
    if (group.durations.length >= 3) {
      const avgDurationMs =
        group.durations.reduce((sum, d) => sum + d, 0) / group.durations.length;
      clusters.push({
        agentName: group.agentName,
        step: group.step,
        modelUsed: group.modelUsed,
        occurrenceCount: group.durations.length,
        avgDurationMs,
      });
    }
  }

  return clusters;
}

/**
 * Fetch the most recent 500 pipeline run log rows from the last 7 days.
 */
async function fetchUnanalyzedRows(db: DbClient): Promise<RunLogRow[]> {
  const result = await db.query<RunLogRow>(`
    SELECT agent_name, step, status, error_message, duration_ms, model_used, city, state
    FROM pipeline_run_log
    WHERE created_at > now() - interval '7 days'
    ORDER BY created_at DESC
    LIMIT 500
  `);
  return result.rows;
}

const UPSERT_PATTERN_SQL = `INSERT INTO learned_repair_patterns
  (pattern_type, agent_name, step, trigger_condition, occurrence_count, first_seen_at, last_seen_at)
VALUES ($1, $2, $3, $4, $5, now(), now())
ON CONFLICT (agent_name, step, trigger_condition) DO UPDATE SET
  occurrence_count = EXCLUDED.occurrence_count,
  last_seen_at = now()`;

/**
 * Single watchdog tick: fetch recent rows, cluster them, and upsert
 * both failure and success patterns into learned_repair_patterns.
 */
export async function runWatchdogTick(db: DbClient): Promise<void> {
  const rows = await fetchUnanalyzedRows(db);

  if (rows.length === 0) {
    return;
  }

  const failureClusters = clusterFailurePatterns(rows);
  const successClusters = clusterSuccessPatterns(rows);

  for (const cluster of failureClusters) {
    await db.query(UPSERT_PATTERN_SQL, [
      "failure_pattern",
      cluster.agentName,
      cluster.step,
      cluster.errorSignature,
      cluster.occurrenceCount,
    ]);
  }

  for (const cluster of successClusters) {
    const triggerCondition = `success via ${cluster.modelUsed} avg ${Math.round(cluster.avgDurationMs)}ms`;
    await db.query(UPSERT_PATTERN_SQL, [
      "success_pattern",
      cluster.agentName,
      cluster.step,
      triggerCondition,
      cluster.occurrenceCount,
    ]);
  }
}

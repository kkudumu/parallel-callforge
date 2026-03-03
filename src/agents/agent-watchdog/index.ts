import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod/v4";
import type { DbClient } from "../../shared/db/client.js";
import type { LlmClient } from "../../shared/cli/llm-client.js";

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

// ─── Task 8: LLM Analysis + Markdown Logging ────────────────────────────────

const PatternAnalysisSchema = z.object({
  root_cause: z.string(),
  permanent_fix: z.string(),
  pattern_label: z.string(),
});

const SuccessAnalysisSchema = z.object({
  observation: z.string(),
  recommendation: z.string(),
  pattern_label: z.string(),
});

const PATTERNS_MD = path.resolve("docs/watchdog/learned-patterns.md");

function appendToMarkdown(section: "Failure Patterns" | "Success Patterns", entry: string): void {
  let content = fs.existsSync(PATTERNS_MD) ? fs.readFileSync(PATTERNS_MD, "utf-8") : "";
  const marker = `## ${section}`;
  const noneMarker = "_None recorded yet._";
  if (content.includes(`${marker}\n\n${noneMarker}`)) {
    content = content.replace(`${marker}\n\n${noneMarker}`, `${marker}\n\n${entry}`);
  } else if (content.includes(marker)) {
    content = content.replace(marker, `${marker}\n\n${entry}\n`);
  } else {
    content += `\n## ${section}\n\n${entry}\n`;
  }
  content = content.replace(
    /_Auto-maintained by WatchdogAgent.*$/m,
    `_Auto-maintained by WatchdogAgent. Last updated: ${new Date().toISOString()}_`
  );
  fs.writeFileSync(PATTERNS_MD, content, "utf-8");
}

// ─── Task 9: Code Promotion ──────────────────────────────────────────────────

const PromotionSchema = z.object({
  file_path: z.string(),
  search_string: z.string(),
  replacement_string: z.string(),
  explanation: z.string(),
});

async function promotePatternToCode(
  patternId: string,
  agentName: string,
  step: string,
  fixStrategy: string,
  triggerCondition: string,
  db: DbClient,
  llm: LlmClient
): Promise<void> {
  const targetFile =
    agentName === "agent-3" && step === "hugo_templates"
      ? "src/agents/agent-3-builder/template-review.ts"
      : agentName === "agent-3"
        ? "src/agents/agent-3-builder/prompts.ts"
        : agentName === "agent-1"
          ? "src/agents/agent-1-keywords/index.ts"
          : null;

  if (!targetFile) {
    console.warn(`[Watchdog] No promotion target for ${agentName}/${step} — skipping`);
    return;
  }

  const currentSource = fs.readFileSync(path.resolve(targetFile), "utf-8");

  const promotion = await llm.call({
    prompt: `You are patching a TypeScript source file to permanently fix a recurring pipeline bug.

File: ${targetFile}
Pattern trigger: ${triggerCondition}
Fix strategy: ${fixStrategy}

Current file content (first 8000 chars):
\`\`\`typescript
${currentSource.slice(0, 8000)}
\`\`\`

Provide a precise string replacement to harden this fix into the source:
- file_path: "${targetFile}"
- search_string: exact string to find in the file (must be unique, verbatim)
- replacement_string: what to replace it with
- explanation: one sentence describing the change`,
    schema: PromotionSchema,
    model: "sonnet",
    logLabel: "[Watchdog][Promotion]",
  });

  const updated = currentSource.replace(promotion.search_string, promotion.replacement_string);
  if (updated === currentSource) {
    console.warn(`[Watchdog] Promotion search_string not found in ${targetFile} — skipping`);
    return;
  }

  fs.writeFileSync(path.resolve(targetFile), updated, "utf-8");

  const commitMsg = `fix(${agentName}): auto-promote ${step} repair rule from watchdog\n\n${promotion.explanation}`;
  execFileSync("git", ["add", targetFile], { cwd: process.cwd() });
  execFileSync("git", ["commit", "-m", commitMsg], { cwd: process.cwd() });

  await db.query(
    `UPDATE learned_repair_patterns SET promoted_to_code = true, promoted_at = now() WHERE id = $1`,
    [patternId]
  );

  appendToMarkdown("Failure Patterns",
    `\n> **PROMOTED**: Pattern \`${triggerCondition}\` hardcoded into \`${targetFile}\`\n`
  );

  console.log(`[Watchdog] Promoted pattern to ${targetFile} and committed`);
}

// ─── Main exported tick with LLM analysis ────────────────────────────────────

export async function runWatchdogTickWithLlm(db: DbClient, llm: LlmClient): Promise<void> {
  await runWatchdogTick(db);

  // Analyze new failure patterns (have no fix_strategy yet, 2+ occurrences)
  const newFailures = await db.query<{
    id: string; agent_name: string; step: string;
    trigger_condition: string; occurrence_count: number;
  }>(
    `SELECT id, agent_name, step, trigger_condition, occurrence_count
     FROM learned_repair_patterns
     WHERE pattern_type = 'failure_pattern'
       AND fix_strategy IS NULL
       AND occurrence_count >= 2`
  );

  for (const row of newFailures.rows) {
    try {
      const analysis = await llm.call({
        prompt: `A recurring failure pattern was detected in a TypeScript pipeline:

Agent: ${row.agent_name}
Step: ${row.step}
Occurrences: ${row.occurrence_count}
Error pattern: ${row.trigger_condition}

Provide:
- root_cause: what is causing this failure
- permanent_fix: how to permanently fix it in code
- pattern_label: a short snake_case label (e.g. nil_slice_first_calls)`,
        schema: PatternAnalysisSchema,
        model: "haiku",
        logLabel: "[Watchdog][FailureAnalysis]",
      });
      await db.query(
        `UPDATE learned_repair_patterns SET fix_strategy = $1, notes = $2 WHERE id = $3`,
        [analysis.permanent_fix, analysis.root_cause, row.id]
      );
      appendToMarkdown("Failure Patterns",
        `### [ACTIVE] ${row.agent_name} / ${row.step} / ${analysis.pattern_label}\n` +
        `- **Trigger**: ${row.trigger_condition}\n` +
        `- **Root cause**: ${analysis.root_cause}\n` +
        `- **Fix**: ${analysis.permanent_fix}\n` +
        `- **Seen**: ${row.occurrence_count} times\n`
      );
      console.log(`[Watchdog] Analyzed failure pattern: ${row.agent_name}/${row.step}/${analysis.pattern_label}`);
    } catch (err) {
      console.warn(`[Watchdog] Failed to analyze pattern ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Analyze new success patterns (no best_practice yet, 3+ occurrences)
  const newSuccesses = await db.query<{
    id: string; agent_name: string; step: string;
    trigger_condition: string; occurrence_count: number;
  }>(
    `SELECT id, agent_name, step, trigger_condition, occurrence_count
     FROM learned_repair_patterns
     WHERE pattern_type = 'success_pattern'
       AND best_practice IS NULL
       AND occurrence_count >= 3`
  );

  for (const row of newSuccesses.rows) {
    try {
      // trigger_condition format: "success via <model> avg <N>ms"
      const tcParts = row.trigger_condition.split(" ");
      const model = tcParts[2] ?? "unknown";       // index 2: model name e.g. "claude"
      const avgMsStr = tcParts[4] ?? "0ms";        // index 4: e.g. "15000ms"
      const avgMs = parseInt(avgMsStr.replace("ms", ""), 10);
      const analysis = await llm.call({
        prompt: `A consistent success pattern was detected:

Agent: ${row.agent_name}
Step: ${row.step}
Model: ${model}
Occurrences: ${row.occurrence_count}
Average duration: ${avgMs}ms

Provide:
- observation: what this pattern tells us
- recommendation: how to leverage this going forward
- pattern_label: a short snake_case label`,
        schema: SuccessAnalysisSchema,
        model: "haiku",
        logLabel: "[Watchdog][SuccessAnalysis]",
      });
      await db.query(
        `UPDATE learned_repair_patterns SET best_practice = $1 WHERE id = $2`,
        [analysis.observation, row.id]
      );
      appendToMarkdown("Success Patterns",
        `### ${row.agent_name} / ${row.step} / ${analysis.pattern_label}\n` +
        `- **Observation**: ${analysis.observation}\n` +
        `- **Recommendation**: ${analysis.recommendation}\n` +
        `- **Seen**: ${row.occurrence_count} times\n`
      );
    } catch (err) {
      console.warn(`[Watchdog] Failed to analyze success pattern ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Promote mature patterns to code (5+ occurrences, fix_strategy set, not yet promoted)
  const readyToPromote = await db.query<{
    id: string; agent_name: string; step: string;
    trigger_condition: string; fix_strategy: string; occurrence_count: number;
  }>(
    `SELECT id, agent_name, step, trigger_condition, fix_strategy, occurrence_count
     FROM learned_repair_patterns
     WHERE pattern_type = 'failure_pattern'
       AND promoted_to_code = false
       AND fix_strategy IS NOT NULL
       AND occurrence_count >= 5`
  );

  for (const row of readyToPromote.rows) {
    try {
      await promotePatternToCode(
        row.id, row.agent_name, row.step, row.fix_strategy, row.trigger_condition, db, llm
      );
    } catch (err) {
      console.warn(`[Watchdog] Promotion failed for ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ─── Main process entry point ─────────────────────────────────────────────────

// Runs when spawned as a child process by the pipeline
if (process.argv[1] && process.argv[1].includes("agent-watchdog")) {
  (async () => {
    const { createDbClient } = await import("../../shared/db/client.js");
    const { createRateLimiters } = await import("../../shared/cli/rate-limiter.js");
    const { createClaudeCli } = await import("../../shared/cli/claude-cli.js");
    const { createCodexCli } = await import("../../shared/cli/codex-cli.js");
    const { createGeminiCli } = await import("../../shared/cli/gemini-cli.js");
    const { createLlmClient } = await import("../../shared/cli/llm-client.js");
    const { getEnv } = await import("../../config/env.js");

    const env = getEnv();
    const db = createDbClient(env.DATABASE_URL);
    const limiters = createRateLimiters();
    const llm = createLlmClient(
      createClaudeCli(env.CLAUDE_CLI_PATH ?? "claude"),
      createCodexCli(env.CODEX_CLI_PATH ?? "codex"),
      limiters,
      createGeminiCli(env.GEMINI_CLI_PATH ?? "gemini")
    );

    console.log("[Watchdog] Started — polling every 60s");
    const interval = setInterval(async () => {
      try {
        await runWatchdogTickWithLlm(db, llm);
      } catch (err) {
        console.warn(`[Watchdog] Tick error: ${err instanceof Error ? err.message : err}`);
      }
    }, 60_000);

    process.on("SIGTERM", async () => {
      console.log("[Watchdog] Shutting down...");
      clearInterval(interval);
      await db.end();
      process.exit(0);
    });
  })();
}

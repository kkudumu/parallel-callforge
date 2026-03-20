import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { getEnv } from "./config/env.js";
import { createDbClient, type DbClient } from "./shared/db/client.js";
import { createRateLimiters } from "./shared/cli/rate-limiter.js";
import { createClaudeCli } from "./shared/cli/claude-cli.js";
import { createCodexCli } from "./shared/cli/codex-cli.js";
import { createGeminiCli } from "./shared/cli/gemini-cli.js";
import { createLlmClient, type LlmClient } from "./shared/cli/llm-client.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 10_000;
const MAX_STDOUT_CAPTURE = 50_000;
const MAX_STDERR_CAPTURE = 50_000;
const SUPERVISOR_HEARTBEAT_MS = 60_000;
const SUPERVISOR_STALL_TIMEOUT_MS = 20 * 60_000;

// ─── Crash Diagnosis Schema ──────────────────────────────────────────────────

const CrashDiagnosisSchema = z.object({
  root_cause: z.string(),
  error_category: z.enum([
    "oom", "timeout", "llm_failure", "db_failure",
    "file_io", "validation", "unhandled", "signal", "unknown",
  ]),
  is_transient: z.boolean(),
  preventive_fix: z.string(),
  pattern_label: z.string(),
  confidence: z.number().min(0).max(1),
});

type CrashDiagnosis = z.infer<typeof CrashDiagnosisSchema>;

interface CrashInfo {
  supervisorRunId: string;
  offerId: string;
  attempt: number;
  exitCode: number | null;
  signal: string | null;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
  memoryUsageMb: number | null;
  crashedAt: Date;
}

export interface SupervisorResult {
  success: boolean;
  totalAttempts: number;
  lastExitCode?: number | null;
  lastSignal?: string | null;
}

// ─── Pipeline Spawning ───────────────────────────────────────────────────────

interface SpawnedPipeline {
  child: ChildProcess;
  stdoutBuffer: { data: string };
  stderrBuffer: { data: string };
  stopHeartbeat: () => void;
}

function spawnPipeline(offerId: string): SpawnedPipeline {
  const stdoutBuffer = { data: "" };
  const stderrBuffer = { data: "" };
  let lastOutputAt = Date.now();
  let lastMeaningfulProgressAt = Date.now();
  const streamRemainders: Record<"stdout" | "stderr", string> = {
    stdout: "",
    stderr: "",
  };

  const isProgressLine = (line: string): boolean => {
    const text = line.trim();
    if (!text) return false;
    if (/still running/i.test(text)) return false;
    if (/last child output/i.test(text)) return false;
    return true;
  };

  const onOutput = (stream: "stdout" | "stderr", chunk: string) => {
    const combined = `${streamRemainders[stream]}${chunk}`;
    const lines = combined.split(/\r?\n/);
    streamRemainders[stream] = lines.pop() ?? "";
    for (const line of lines) {
      if (isProgressLine(line)) {
        lastMeaningfulProgressAt = Date.now();
      }
    }
  };

  const child = spawn("npx", ["tsx", "src/index.ts", "pipeline-once", offerId], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    detached: false,
  });

  child.stdout!.on("data", (chunk: Buffer) => {
    lastOutputAt = Date.now();
    const text = chunk.toString();
    onOutput("stdout", text);
    process.stdout.write(text);
    stdoutBuffer.data += text;
    if (stdoutBuffer.data.length > MAX_STDOUT_CAPTURE) {
      stdoutBuffer.data = stdoutBuffer.data.slice(-MAX_STDOUT_CAPTURE);
    }
  });

  child.stderr!.on("data", (chunk: Buffer) => {
    lastOutputAt = Date.now();
    const text = chunk.toString();
    onOutput("stderr", text);
    process.stderr.write(text);
    stderrBuffer.data += text;
    if (stderrBuffer.data.length > MAX_STDERR_CAPTURE) {
      stderrBuffer.data = stderrBuffer.data.slice(-MAX_STDERR_CAPTURE);
    }
  });

  const heartbeat = setInterval(() => {
    const idleSeconds = Math.max(1, Math.round((Date.now() - lastOutputAt) / 1000));
    const noProgressSeconds = Math.max(
      1,
      Math.round((Date.now() - lastMeaningfulProgressAt) / 1000)
    );
    console.log(
      `[Supervisor] Pipeline still running (pid=${child.pid ?? "unknown"}), ` +
      `last child output ${idleSeconds}s ago, no meaningful progress ${noProgressSeconds}s`
    );
    if (Date.now() - lastMeaningfulProgressAt > SUPERVISOR_STALL_TIMEOUT_MS) {
      console.error(
        `[Supervisor] Stall detected: no meaningful child progress for ` +
        `${Math.round(SUPERVISOR_STALL_TIMEOUT_MS / 60000)} minutes. Killing child for supervised retry.`
      );
      child.kill("SIGTERM");
    }
  }, SUPERVISOR_HEARTBEAT_MS);

  const stopHeartbeat = () => {
    clearInterval(heartbeat);
  };
  child.on("exit", stopHeartbeat);
  child.on("error", stopHeartbeat);

  return { child, stdoutBuffer, stderrBuffer, stopHeartbeat };
}

// ─── Crash Diagnosis ─────────────────────────────────────────────────────────

async function diagnoseCrash(
  llm: LlmClient,
  db: DbClient,
  crash: CrashInfo
): Promise<CrashDiagnosis> {
  // Fetch recent pipeline_run_log entries for context
  const recentLogs = await db.query<{
    agent_name: string; step: string; status: string;
    error_message: string | null; duration_ms: number;
  }>(
    `SELECT agent_name, step, status, error_message, duration_ms
     FROM pipeline_run_log
     WHERE offer_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [crash.offerId]
  );

  // Fetch recent learned_repair_patterns failure entries
  const recentPatterns = await db.query<{
    agent_name: string; step: string; trigger_condition: string;
    fix_strategy: string | null;
  }>(
    `SELECT agent_name, step, trigger_condition, fix_strategy
     FROM learned_repair_patterns
     WHERE pattern_type = 'failure_pattern'
     ORDER BY last_seen_at DESC
     LIMIT 10`
  );

  const logsContext = recentLogs.rows
    .map((r) => `  ${r.agent_name}/${r.step}: ${r.status}${r.error_message ? ` — ${r.error_message.slice(0, 200)}` : ""} (${r.duration_ms}ms)`)
    .join("\n");

  const patternsContext = recentPatterns.rows
    .map((r) => `  ${r.agent_name}/${r.step}: ${r.trigger_condition}${r.fix_strategy ? ` → fix: ${r.fix_strategy.slice(0, 200)}` : ""}`)
    .join("\n");

  const stderrSnippet = crash.stderrTail.slice(-4096);
  const stdoutSnippet = crash.stdoutTail.slice(-2048);

  const prompt = `You are diagnosing a crashed pipeline process. Analyze the crash and provide a structured diagnosis.

## Crash Details
- Exit code: ${crash.exitCode}
- Signal: ${crash.signal ?? "none"}
- Duration: ${crash.durationMs}ms
- Memory usage: ${crash.memoryUsageMb ?? "unknown"}MB
- Attempt: ${crash.attempt} of ${MAX_RETRIES}

## stderr (last 4KB):
\`\`\`
${stderrSnippet}
\`\`\`

## stdout (last 2KB):
\`\`\`
${stdoutSnippet}
\`\`\`

## Recent pipeline_run_log entries:
${logsContext || "  (none)"}

## Known failure patterns:
${patternsContext || "  (none)"}

Provide:
- root_cause: concise explanation of what caused the crash
- error_category: one of oom, timeout, llm_failure, db_failure, file_io, validation, unhandled, signal, unknown
- is_transient: true if retrying might succeed (e.g. transient network error), false if permanent (e.g. code bug)
- preventive_fix: how to permanently prevent this crash
- pattern_label: a short snake_case label (e.g. agent1_oom_large_city_set)
- confidence: 0-1 how confident you are in this diagnosis`;

  return llm.call({
    prompt,
    schema: CrashDiagnosisSchema,
    model: "sonnet",
    logLabel: "[Supervisor][Diagnosis]",
  });
}

// ─── Crash Logging ───────────────────────────────────────────────────────────

async function logCrash(
  db: DbClient,
  crash: CrashInfo,
  diagnosis: CrashDiagnosis | null
): Promise<void> {
  await db.query(
    `INSERT INTO pipeline_crashes (
      supervisor_run_id, offer_id, attempt, exit_code, signal,
      stdout_tail, stderr_tail, duration_ms, memory_usage_mb, crashed_at,
      diagnosis_root_cause, diagnosis_category, diagnosis_is_transient,
      diagnosis_preventive_fix, diagnosis_pattern_label, diagnosis_confidence
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      crash.supervisorRunId,
      crash.offerId,
      crash.attempt,
      crash.exitCode,
      crash.signal,
      crash.stdoutTail.slice(-4096),
      crash.stderrTail.slice(-4096),
      crash.durationMs,
      crash.memoryUsageMb,
      crash.crashedAt,
      diagnosis?.root_cause ?? null,
      diagnosis?.error_category ?? null,
      diagnosis?.is_transient ?? null,
      diagnosis?.preventive_fix ?? null,
      diagnosis?.pattern_label ?? null,
      diagnosis?.confidence ?? null,
    ]
  );
}

// ─── Persist Diagnosis as Learned Pattern ────────────────────────────────────

function parseLastAgent(stdout: string): string {
  // Look for "Step N/4: <agent>" or "[AgentN]" patterns in stdout
  const stepMatch = stdout.match(/Step (\d)\/4/g);
  if (stepMatch && stepMatch.length > 0) {
    const lastStep = stepMatch[stepMatch.length - 1];
    const num = lastStep.match(/Step (\d)/)?.[1];
    const agentMap: Record<string, string> = {
      "1": "agent-0.5",
      "2": "agent-1",
      "3": "agent-2",
      "4": "agent-3",
    };
    return agentMap[num ?? ""] ?? "pipeline";
  }
  return "pipeline";
}

async function persistDiagnosisAsPattern(
  db: DbClient,
  diagnosis: CrashDiagnosis,
  crash: CrashInfo
): Promise<void> {
  const agentName = parseLastAgent(crash.stdoutTail);
  const step = `process_crash:${diagnosis.error_category}`;
  const triggerCondition = diagnosis.pattern_label;

  await db.query(
    `INSERT INTO learned_repair_patterns
      (pattern_type, agent_name, step, trigger_condition, fix_strategy, occurrence_count, first_seen_at, last_seen_at, notes)
    VALUES ('failure_pattern', $1, $2, $3, $4, 1, now(), now(), $5)
    ON CONFLICT (agent_name, step, trigger_condition) DO UPDATE SET
      occurrence_count = learned_repair_patterns.occurrence_count + 1,
      last_seen_at = now(),
      fix_strategy = COALESCE(EXCLUDED.fix_strategy, learned_repair_patterns.fix_strategy),
      notes = COALESCE(EXCLUDED.notes, learned_repair_patterns.notes)`,
    [
      agentName,
      step,
      triggerCondition,
      diagnosis.preventive_fix,
      diagnosis.root_cause,
    ]
  );
}

// ─── Discord Notification ────────────────────────────────────────────────────

async function notifyDiscord(
  webhookUrl: string,
  payload: { offerId: string; totalAttempts: number; lastDiagnosis?: CrashDiagnosis | null }
): Promise<void> {
  const embed = {
    title: "Pipeline Supervisor: All Retries Exhausted",
    color: 0xed4245,
    fields: [
      { name: "Offer", value: `\`${payload.offerId}\``, inline: true },
      { name: "Attempts", value: `${payload.totalAttempts}`, inline: true },
      ...(payload.lastDiagnosis
        ? [
            { name: "Category", value: payload.lastDiagnosis.error_category, inline: true },
            { name: "Root Cause", value: payload.lastDiagnosis.root_cause.slice(0, 1024) },
            { name: "Fix", value: payload.lastDiagnosis.preventive_fix.slice(0, 1024) },
          ]
        : []),
    ],
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      console.warn(`[Supervisor] Discord webhook returned ${res.status}`);
    }
  } catch (err: any) {
    console.warn(`[Supervisor] Failed to send Discord notification: ${err.message}`);
  }
}

// ─── Main Supervisor Loop ────────────────────────────────────────────────────

export async function runSupervisor(offerId: string): Promise<SupervisorResult> {
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);
  const limiters = createRateLimiters();
  const claudeCli = createClaudeCli(env.CLAUDE_CLI_PATH);
  const codexCli = createCodexCli(env.CODEX_CLI_PATH);
  const geminiCli = createGeminiCli(env.GEMINI_CLI_PATH);
  const llm = createLlmClient(claudeCli, codexCli, limiters, geminiCli);

  const supervisorRunId = `sup-${randomUUID()}`;
  console.log(`[Supervisor] Run ID: ${supervisorRunId}`);
  console.log(`[Supervisor] Max retries: ${MAX_RETRIES}, backoff: ${BASE_BACKOFF_MS}ms`);

  let lastDiagnosis: CrashDiagnosis | null = null;
  let activeChild: ChildProcess | null = null;
  let lastExitCode: number | null = null;
  let lastSignal: string | null = null;
  let pendingSignal: NodeJS.Signals | null = null;

  // Forward signals to child so pipeline cleanup runs
  const forwardSignal = (sig: NodeJS.Signals) => {
    if (activeChild && !activeChild.killed) {
      activeChild.kill(sig);
    }
  };
  const onSigint = () => {
    pendingSignal = "SIGINT";
    console.log("\n[Supervisor] SIGINT received, forwarding to pipeline...");
    forwardSignal("SIGINT");
  };
  const onSigterm = () => {
    pendingSignal = "SIGTERM";
    console.log("[Supervisor] SIGTERM received, forwarding to pipeline...");
    forwardSignal("SIGTERM");
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`\n[Supervisor] Attempt ${attempt}/${MAX_RETRIES}`);
      const startTime = Date.now();

      const { child, stdoutBuffer, stderrBuffer, stopHeartbeat } = spawnPipeline(offerId);
      activeChild = child;

      const { exitCode, signal } = await new Promise<{ exitCode: number | null; signal: string | null }>(
        (resolve) => {
          child.on("exit", (code, sig) => {
            resolve({ exitCode: code, signal: sig });
          });
          child.on("error", (err) => {
            console.error(`[Supervisor] Spawn error: ${err.message}`);
            resolve({ exitCode: 1, signal: null });
          });
        }
      );

      activeChild = null;
      stopHeartbeat();
      const durationMs = Date.now() - startTime;
      lastExitCode = exitCode;
      lastSignal = signal;

      // If supervisor received termination signal, stop retry loop immediately.
      if (pendingSignal) {
        throw new Error(`Supervisor interrupted by ${pendingSignal}`);
      }

      // Success
      if (exitCode === 0) {
        console.log(`[Supervisor] Pipeline completed successfully (${durationMs}ms)`);
        return { success: true, totalAttempts: attempt };
      }

      // Crash
      console.error(`[Supervisor] Pipeline crashed: exit=${exitCode} signal=${signal} duration=${durationMs}ms`);

      const memoryUsageMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

      const crash: CrashInfo = {
        supervisorRunId,
        offerId,
        attempt,
        exitCode,
        signal,
        stdoutTail: stdoutBuffer.data,
        stderrTail: stderrBuffer.data,
        durationMs,
        memoryUsageMb,
        crashedAt: new Date(),
      };

      // Diagnose via LLM
      let diagnosis: CrashDiagnosis | null = null;
      try {
        console.log("[Supervisor] Diagnosing crash via LLM...");
        diagnosis = await diagnoseCrash(llm, db, crash);
        lastDiagnosis = diagnosis;
        console.log(`[Supervisor] Diagnosis: ${diagnosis.error_category} (confidence: ${diagnosis.confidence})`);
        console.log(`[Supervisor] Root cause: ${diagnosis.root_cause}`);
        console.log(`[Supervisor] Transient: ${diagnosis.is_transient}`);
      } catch (err: any) {
        console.warn(`[Supervisor] Diagnosis failed: ${err.message}`);
      }

      // Log crash to DB
      try {
        await logCrash(db, crash, diagnosis);
      } catch (err: any) {
        console.warn(`[Supervisor] Failed to log crash: ${err.message}`);
      }

      // Persist to learned_repair_patterns
      if (diagnosis) {
        try {
          await persistDiagnosisAsPattern(db, diagnosis, crash);
        } catch (err: any) {
          console.warn(`[Supervisor] Failed to persist pattern: ${err.message}`);
        }
      }

      // Early exit on non-transient + high confidence
      if (diagnosis && !diagnosis.is_transient && diagnosis.confidence > 0.8) {
        console.error(`[Supervisor] Non-transient failure with high confidence (${diagnosis.confidence}) — stopping retries`);
        return {
          success: false,
          totalAttempts: attempt,
          lastExitCode,
          lastSignal,
        };
      }

      // Backoff before next retry
      if (attempt < MAX_RETRIES) {
        const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.log(`[Supervisor] Waiting ${backoffMs}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        if (pendingSignal) {
          throw new Error(`Supervisor interrupted by ${pendingSignal}`);
        }
      }
    }

    // All retries exhausted
    console.error(`[Supervisor] All ${MAX_RETRIES} attempts exhausted`);
    if (env.DISCORD_WEBHOOK_URL) {
      await notifyDiscord(env.DISCORD_WEBHOOK_URL, {
        offerId,
        totalAttempts: MAX_RETRIES,
        lastDiagnosis,
      });
    }

    return {
      success: false,
      totalAttempts: MAX_RETRIES,
      lastExitCode,
      lastSignal,
    };
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await db.end();
  }
}

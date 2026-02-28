import { createDbClient } from "../shared/db/client.js";
import { createDlqManager } from "./dlq-manager.js";
import { createTaskScheduler } from "./task-scheduler.js";
import { createRateLimiters } from "../shared/cli/rate-limiter.js";
import { createClaudeCli } from "../shared/cli/claude-cli.js";
import { createCodexCli } from "../shared/cli/codex-cli.js";
import { createLlmClient } from "../shared/cli/llm-client.js";
import { getEnv } from "../config/env.js";
import type { AgentHandler, TaskRecord } from "./types.js";

export interface OrchestratorDeps {
  agentHandlers: Map<string, AgentHandler>;
  pollIntervalMs?: number;
  maxConcurrent?: number;
}

export async function createOrchestrator(deps: OrchestratorDeps) {
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);
  const dlq = createDlqManager(db);
  const scheduler = createTaskScheduler(db, dlq);
  const limiters = createRateLimiters();
  const claudeCli = createClaudeCli(env.CLAUDE_CLI_PATH);
  const codexCli = createCodexCli(env.CODEX_CLI_PATH);
  const llm = createLlmClient(claudeCli, codexCli, limiters);

  const { agentHandlers, pollIntervalMs = 5000, maxConcurrent = 1 } = deps;
  let running = false;
  let activeCount = 0;

  async function processTask(task: TaskRecord) {
    const handler = agentHandlers.get(task.agent_name);
    if (!handler) {
      await scheduler.markFailed(task.id, `No handler for agent: ${task.agent_name}`);
      return;
    }

    await scheduler.markRunning(task.id);
    console.log(`[orchestrator] Running task ${task.id} (${task.task_type} → ${task.agent_name})`);

    try {
      activeCount++;
      await handler.execute(task.payload);
      await scheduler.markCompleted(task.id);
      console.log(`[orchestrator] Completed task ${task.id}`);
    } catch (err: any) {
      console.error(`[orchestrator] Task ${task.id} failed: ${err.message}`);
      await scheduler.markFailed(task.id, err.message);

      await dlq.addToDLQ({
        originalTaskId: task.id,
        taskType: task.task_type,
        agentName: task.agent_name,
        payload: task.payload,
        error: err,
        retryCount: 1,
      });
    } finally {
      activeCount--;
    }
  }

  async function poll() {
    if (activeCount >= maxConcurrent) return;

    const ready = await scheduler.getReadyTasks();
    if (ready.length === 0) return;

    const slotsAvailable = maxConcurrent - activeCount;
    const batch = ready.slice(0, slotsAvailable);

    await Promise.all(batch.map(processTask));
  }

  return {
    scheduler,
    dlq,
    llm,
    db,

    async start() {
      running = true;
      console.log("[orchestrator] Started polling for tasks");
      while (running) {
        try {
          await poll();
        } catch (err: any) {
          console.error(`[orchestrator] Poll error: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    },

    stop() {
      running = false;
      console.log("[orchestrator] Stopping...");
    },

    async shutdown() {
      this.stop();
      await db.end();
    },
  };
}

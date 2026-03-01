import { createDbClient } from "../shared/db/client.js";
import { createDlqManager, classifyError } from "./dlq-manager.js";
import { createTaskScheduler } from "./task-scheduler.js";
import { createRateLimiters } from "../shared/cli/rate-limiter.js";
import { createClaudeCli } from "../shared/cli/claude-cli.js";
import { createCodexCli } from "../shared/cli/codex-cli.js";
import { createLlmClient } from "../shared/cli/llm-client.js";
import { getEnv } from "../config/env.js";
import { eventBus } from "../shared/events/event-bus.js";
import type { AgentName } from "../shared/events/event-types.js";
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
  const MAX_TASK_RETRIES = 3;
  const RETRY_BACKOFF_BASE_MS = 5_000;
  let running = false;
  let activeCount = 0;

  // In-memory retry tracking — reset on restart, DLQ handles cross-run persistence
  const retryCounts = new Map<string, number>();
  const retryAfter = new Map<string, number>();

  async function processTask(task: TaskRecord) {
    const handler = agentHandlers.get(task.agent_name);
    if (!handler) {
      await scheduler.markFailed(task.id, `No handler for agent: ${task.agent_name}`);
      return;
    }

    await scheduler.markRunning(task.id);
    console.log(`[orchestrator] Running task ${task.id} (${task.task_type} → ${task.agent_name})`);
    const agentName = task.agent_name as AgentName;
    const startTime = Date.now();

    eventBus.emitEvent({
      type: "agent_start",
      agent: agentName,
      taskId: task.id,
      timestamp: startTime,
    });
    eventBus.emitEvent({
      type: "task_status_change",
      taskId: task.id,
      agent: agentName,
      from: "pending",
      to: "running",
      timestamp: startTime,
    });

    try {
      activeCount++;
      await handler.execute(task.payload);
      await scheduler.markCompleted(task.id);
      retryCounts.delete(task.id);
      retryAfter.delete(task.id);
      console.log(`[orchestrator] Completed task ${task.id}`);
      eventBus.emitEvent({
        type: "agent_complete",
        agent: agentName,
        taskId: task.id,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      });
      eventBus.emitEvent({
        type: "task_status_change",
        taskId: task.id,
        agent: agentName,
        from: "running",
        to: "completed",
        timestamp: Date.now(),
      });
    } catch (err: any) {
      const errorClass = classifyError(err);
      const retryCount = (retryCounts.get(task.id) ?? 0) + 1;
      retryCounts.set(task.id, retryCount);

      if (errorClass !== "permanent" && retryCount < MAX_TASK_RETRIES) {
        // Transient/unknown: re-queue with exponential backoff
        const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, retryCount - 1);
        console.warn(
          `[orchestrator] Task ${task.id} transient failure (${errorClass}), retry ${retryCount}/${MAX_TASK_RETRIES} after ${backoffMs}ms: ${err.message}`
        );
        await scheduler.markPending(task.id);
        retryAfter.set(task.id, Date.now() + backoffMs);
        eventBus.emitEvent({
          type: "agent_step",
          agent: agentName,
          step: "Retry scheduled",
          detail: `${err.message} (retry ${retryCount}/${MAX_TASK_RETRIES} in ${Math.ceil(backoffMs / 1000)}s)`,
          timestamp: Date.now(),
        });
        eventBus.emitEvent({
          type: "task_status_change",
          taskId: task.id,
          agent: agentName,
          from: "running",
          to: "pending",
          timestamp: Date.now(),
        });
      } else {
        // Permanent error or retries exhausted: send to DLQ
        console.error(
          `[orchestrator] Task ${task.id} failed permanently (${errorClass}, retries: ${retryCount}): ${err.message}`
        );
        await scheduler.markFailed(task.id, err.message);
        retryCounts.delete(task.id);
        retryAfter.delete(task.id);
        eventBus.emitEvent({
          type: "agent_error",
          agent: agentName,
          taskId: task.id,
          error: err.message,
          timestamp: Date.now(),
        });
        eventBus.emitEvent({
          type: "task_status_change",
          taskId: task.id,
          agent: agentName,
          from: "running",
          to: "failed",
          timestamp: Date.now(),
        });

        await dlq.addToDLQ({
          originalTaskId: task.id,
          taskType: task.task_type,
          agentName: task.agent_name,
          payload: task.payload,
          error: err,
          retryCount,
        });
      }
    } finally {
      activeCount--;
    }
  }

  async function poll() {
    if (activeCount >= maxConcurrent) return;

    const ready = await scheduler.getReadyTasks();
    if (ready.length === 0) return;

    // Filter out tasks still in backoff
    const now = Date.now();
    const eligible = ready.filter((t) => {
      const notBefore = retryAfter.get(t.id);
      return !notBefore || notBefore <= now;
    });
    if (eligible.length === 0) return;

    const slotsAvailable = maxConcurrent - activeCount;
    const batch = eligible.slice(0, slotsAvailable);

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

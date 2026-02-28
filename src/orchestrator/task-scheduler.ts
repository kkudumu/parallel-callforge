import type { DbClient } from "../shared/db/client.js";
import type { TaskRecord, AgentHandler } from "./types.js";
import type { DlqManager } from "./dlq-manager.js";

export function getReadyTasks(tasks: TaskRecord[]): TaskRecord[] {
  const statusMap = new Map(tasks.map((t) => [t.id, t.status]));

  return tasks.filter((t) => {
    if (t.status !== "pending") return false;

    return t.dependencies.every((depId) => {
      const depStatus = statusMap.get(depId);
      return depStatus === "completed";
    });
  });
}

export interface TaskScheduler {
  createTask(taskType: string, agentName: string, payload: Record<string, unknown>, dependencies?: string[]): Promise<string>;
  getAllTasks(): Promise<TaskRecord[]>;
  getReadyTasks(): Promise<TaskRecord[]>;
  markRunning(taskId: string): Promise<void>;
  markCompleted(taskId: string): Promise<void>;
  markFailed(taskId: string, error: string): Promise<void>;
}

export function createTaskScheduler(db: DbClient, dlq: DlqManager): TaskScheduler {
  return {
    async createTask(taskType, agentName, payload, dependencies = []) {
      if (await dlq.isInDLQ(taskType, agentName, payload)) {
        console.warn(`Task in DLQ, skipping: ${taskType}/${agentName}`);
        throw new Error(`Task poisoned (in DLQ): ${taskType}/${agentName}`);
      }

      const result = await db.query(
        `INSERT INTO agent_tasks (task_type, agent_name, payload, dependencies)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [taskType, agentName, JSON.stringify(payload), dependencies]
      );
      return result.rows[0].id;
    },

    async getAllTasks() {
      const result = await db.query<TaskRecord>(
        "SELECT * FROM agent_tasks ORDER BY created_at"
      );
      return result.rows;
    },

    async getReadyTasks() {
      const allTasks = await this.getAllTasks();
      return getReadyTasks(allTasks);
    },

    async markRunning(taskId) {
      await db.query(
        "UPDATE agent_tasks SET status = 'running', started_at = now() WHERE id = $1",
        [taskId]
      );
    },

    async markCompleted(taskId) {
      await db.query(
        "UPDATE agent_tasks SET status = 'completed', completed_at = now() WHERE id = $1",
        [taskId]
      );
    },

    async markFailed(taskId, error) {
      await db.query(
        "UPDATE agent_tasks SET status = 'failed', completed_at = now(), error_message = $1 WHERE id = $2",
        [error, taskId]
      );
    },
  };
}

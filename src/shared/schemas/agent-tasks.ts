import { z } from "zod/v4";

export const AgentTaskSchema = z.object({
  task_type: z.string().min(1).describe("Type of task"),
  agent_name: z.string().min(1).describe("Assigned agent"),
  payload: z.record(z.string(), z.any()).describe("Task payload"),
  status: z
    .enum(["pending", "running", "completed", "failed"])
    .default("pending"),
  dependencies: z.array(z.string()).default([]).describe("Task IDs this depends on"),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

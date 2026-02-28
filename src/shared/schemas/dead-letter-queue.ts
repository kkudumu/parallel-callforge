import { z } from "zod/v4";

export const DlqEntrySchema = z.object({
  original_task_id: z.string().describe("Original task UUID"),
  task_type: z.string().describe("Task type"),
  agent_name: z.string().describe("Agent that failed"),
  payload: z.record(z.string(), z.any()).describe("Original payload"),
  error_message: z.string().describe("Error description"),
  error_stack: z.string().optional(),
  error_class: z
    .enum(["transient", "permanent", "unknown"])
    .default("unknown")
    .describe("Error classification"),
  retry_count: z.number().int().default(0),
  max_retries: z.number().int().default(3),
});

export type DlqEntry = z.infer<typeof DlqEntrySchema>;

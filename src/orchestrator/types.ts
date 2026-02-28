export interface TaskRecord {
  id: string;
  task_type: string;
  agent_name: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  dependencies: string[];
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  error_message: string | null;
}

export interface AgentHandler {
  name: string;
  execute(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

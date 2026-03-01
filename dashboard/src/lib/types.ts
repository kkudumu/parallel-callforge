export type AgentName = "agent-1" | "agent-2" | "agent-3" | "agent-7";
export type AgentStatus = "idle" | "running" | "completed" | "error";

export interface AgentStartEvent {
  type: "agent_start";
  agent: AgentName;
  taskId?: string;
  timestamp: number;
}

export interface AgentStepEvent {
  type: "agent_step";
  agent: AgentName;
  step: string;
  detail?: string;
  timestamp: number;
}

export interface AgentCompleteEvent {
  type: "agent_complete";
  agent: AgentName;
  taskId?: string;
  duration: number;
  timestamp: number;
}

export interface AgentErrorEvent {
  type: "agent_error";
  agent: AgentName;
  taskId?: string;
  error: string;
  timestamp: number;
}

export interface AgentStatusEvent {
  type: "agent_status";
  agent: AgentName;
  status: AgentStatus;
  currentStep: string;
  currentDetail: string;
  lastError: string;
  completedAt: number | null;
  startedAt: number | null;
  duration: number | null;
  timestamp: number;
}

export interface TaskStatusChangeEvent {
  type: "task_status_change";
  taskId: string;
  agent: AgentName;
  from: string;
  to: string;
  timestamp: number;
}

export interface PipelineStatsEvent {
  type: "pipeline_stats";
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
  pendingTasks: number;
  totalPages: number;
  totalAlerts: number;
  timestamp: number;
}

export interface HealthScoreEvent {
  type: "health_score";
  score: number;
  interpretation: string;
  indexedPages: number;
  totalPages: number;
  criticalAlerts: number;
  timestamp: number;
}

export type PipelineRunStatus = "idle" | "running" | "completed" | "error";

export interface PipelineRunEvent {
  type: "pipeline_run";
  status: PipelineRunStatus;
  message: string;
  timestamp: number;
}

export interface SiteDeployedEvent {
  type: "site_deployed";
  url: string;
  siteId: string;
  city: string;
  agent: AgentName;
  timestamp: number;
}

export type LogLevel = "info" | "warn" | "error";

export interface PipelineLogEvent {
  type: "pipeline_log";
  level: LogLevel;
  message: string;
  source?: string;
  timestamp: number;
}

export type DashboardEvent =
  | AgentStartEvent
  | AgentStepEvent
  | AgentCompleteEvent
  | AgentErrorEvent
  | AgentStatusEvent
  | TaskStatusChangeEvent
  | PipelineStatsEvent
  | HealthScoreEvent
  | PipelineRunEvent
  | SiteDeployedEvent
  | PipelineLogEvent;

export interface AgentState {
  name: AgentName;
  status: AgentStatus;
  currentStep: string;
  currentDetail: string;
  lastError: string;
  completedAt: number | null;
  startedAt: number | null;
  duration: number | null;
}

export interface PipelineStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
  pendingTasks: number;
  totalPages: number;
  totalAlerts: number;
}

export interface HealthScore {
  score: number;
  interpretation: string;
  indexedPages: number;
  totalPages: number;
  criticalAlerts: number;
}

export interface FeedEntry {
  id: string;
  type: DashboardEvent["type"];
  agent?: AgentName;
  message: string;
  timestamp: number;
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  source?: string;
  timestamp: number;
}

export interface DeployedSite {
  url: string;
  siteId: string;
  city: string;
  timestamp: number;
}

export interface PipelineState {
  agents: Record<AgentName, AgentState>;
  stats: PipelineStats;
  health: HealthScore;
  feed: FeedEntry[];
  connected: boolean;
  pipelineRunStatus: PipelineRunStatus;
  pipelineRunMessage: string;
  deployedSites: DeployedSite[];
  logs: LogEntry[];
}

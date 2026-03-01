import { useReducer, useCallback } from "react";
import type {
  PipelineState,
  DashboardEvent,
  AgentName,
  AgentState,
  FeedEntry,
  DeployedSite,
  LogEntry,
} from "../lib/types";
import { MAX_FEED_ENTRIES, AGENTS } from "../lib/constants";

const initialAgentState = (name: AgentName): AgentState => ({
  name,
  status: "idle",
  currentStep: "",
  currentDetail: "",
  lastError: "",
  completedAt: null,
  startedAt: null,
  duration: null,
});

const initialState: PipelineState = {
  agents: {
    "agent-1": initialAgentState("agent-1"),
    "agent-2": initialAgentState("agent-2"),
    "agent-3": initialAgentState("agent-3"),
    "agent-7": initialAgentState("agent-7"),
  },
  stats: {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    runningTasks: 0,
    pendingTasks: 0,
    totalPages: 0,
    totalAlerts: 0,
  },
  health: {
    score: 0,
    interpretation: "Unknown",
    indexedPages: 0,
    totalPages: 0,
    criticalAlerts: 0,
  },
  feed: [],
  connected: false,
  pipelineRunStatus: "idle",
  pipelineRunMessage: "",
  deployedSites: [],
  logs: [],
};

let feedCounter = 0;

function isDuplicateLog(state: PipelineState, event: Extract<DashboardEvent, { type: "pipeline_log" }>): boolean {
  return state.logs.some((log) =>
    log.timestamp === event.timestamp &&
    log.level === event.level &&
    log.source === event.source &&
    log.message === event.message
  );
}

function isDuplicateFeedEvent(state: PipelineState, event: DashboardEvent, message: string): boolean {
  return state.feed.some((entry) =>
    entry.type === event.type &&
    entry.timestamp === event.timestamp &&
    entry.agent === ("agent" in event ? event.agent : undefined) &&
    entry.message === message
  );
}

function eventToFeedMessage(event: DashboardEvent): string {
  switch (event.type) {
    case "agent_start": {
      const meta = AGENTS[event.agent];
      return `${meta.label} started working`;
    }
    case "agent_step": {
      const meta = AGENTS[event.agent];
      return `${meta.label}: ${event.step}${event.detail ? ` — ${event.detail}` : ""}`;
    }
    case "agent_complete": {
      const meta = AGENTS[event.agent];
      const secs = event.duration ? `${(event.duration / 1000).toFixed(1)}s` : "";
      return `${meta.label} finished ${secs ? `in ${secs}` : ""}`;
    }
    case "agent_error": {
      const meta = AGENTS[event.agent];
      return `${meta.label} error: ${event.error}`;
    }
    case "task_status_change":
      return `Task ${event.taskId.slice(0, 8)}... → ${event.to}`;
    case "pipeline_stats":
      return `Stats: ${event.completedTasks}/${event.totalTasks} tasks, ${event.totalPages} pages`;
    case "health_score":
      return `Health: ${event.score}/100 — ${event.interpretation}`;
    case "pipeline_run":
      return event.message || `Pipeline ${event.status}`;
    case "site_deployed":
      return `Site deployed: ${event.url}`;
    case "pipeline_log":
      return event.message;
    case "agent_status":
      return `${AGENTS[event.agent].label} status refreshed`;
  }
}

type Action =
  | { type: "event"; event: DashboardEvent }
  | { type: "set_connected"; connected: boolean };

function reducer(state: PipelineState, action: Action): PipelineState {
  switch (action.type) {
    case "set_connected":
      return { ...state, connected: action.connected };

    case "event": {
      const event = action.event;
      let newState = { ...state };

      // Accumulate log entries
      if (event.type === "pipeline_log") {
        if (!isDuplicateLog(state, event)) {
          const logEntry: LogEntry = {
            id: `log-${++feedCounter}`,
            level: event.level,
            message: event.message,
            source: event.source,
            timestamp: event.timestamp,
          };
          newState.logs = [...state.logs, logEntry].slice(-500);
        }
      }

      // Create feed entry (skip pipeline_stats, logs, and idle pipeline_run to avoid spam)
      const skipFeed = event.type === "pipeline_stats" ||
        event.type === "pipeline_log" ||
        event.type === "agent_status" ||
        (event.type === "pipeline_run" && event.status === "idle" && !event.message);
      if (!skipFeed) {
        const message = eventToFeedMessage(event);
        if (!isDuplicateFeedEvent(state, event, message)) {
          const feedEntry: FeedEntry = {
            id: `feed-${++feedCounter}`,
            type: event.type,
            agent: "agent" in event ? (event as any).agent : undefined,
            message,
            timestamp: event.timestamp,
          };
          newState.feed = [feedEntry, ...state.feed].slice(0, MAX_FEED_ENTRIES);
        }
      }

      switch (event.type) {
        case "agent_start":
          newState.agents = {
            ...state.agents,
            [event.agent]: {
              ...state.agents[event.agent],
              status: "running",
              currentStep: "Starting...",
              currentDetail: "",
              lastError: "",
              startedAt: event.timestamp,
              completedAt: null,
              duration: null,
            },
          };
          break;

        case "agent_step":
          newState.agents = {
            ...state.agents,
            [event.agent]: {
              ...state.agents[event.agent],
              status: "running",
              currentStep: event.step,
              currentDetail: event.detail ?? "",
            },
          };
          break;

        case "agent_complete":
          newState.agents = {
            ...state.agents,
            [event.agent]: {
              ...state.agents[event.agent],
              status: "completed",
              currentStep: "Done!",
              completedAt: event.timestamp,
              duration: event.duration,
            },
          };
          break;

        case "agent_error":
          newState.agents = {
            ...state.agents,
            [event.agent]: {
              ...state.agents[event.agent],
              status: "error",
              currentStep: "Error",
              lastError: event.error,
            },
          };
          break;

        case "agent_status":
          newState.agents = {
            ...state.agents,
            [event.agent]: {
              ...state.agents[event.agent],
              status: event.status,
              currentStep: event.currentStep,
              currentDetail: event.currentDetail,
              lastError: event.lastError,
              completedAt: event.completedAt,
              startedAt: event.startedAt,
              duration: event.duration,
            },
          };
          break;

        case "pipeline_stats":
          newState.stats = {
            totalTasks: event.totalTasks,
            completedTasks: event.completedTasks,
            failedTasks: event.failedTasks,
            runningTasks: event.runningTasks,
            pendingTasks: event.pendingTasks,
            totalPages: event.totalPages,
            totalAlerts: event.totalAlerts,
          };
          break;

        case "health_score":
          newState.health = {
            score: event.score,
            interpretation: event.interpretation,
            indexedPages: event.indexedPages,
            totalPages: event.totalPages,
            criticalAlerts: event.criticalAlerts,
          };
          break;

        case "pipeline_run":
          newState.pipelineRunStatus = event.status;
          newState.pipelineRunMessage = event.message;
          break;

        case "site_deployed": {
          const site: DeployedSite = {
            url: event.url,
            siteId: event.siteId,
            city: event.city,
            timestamp: event.timestamp,
          };
          newState.deployedSites = [...state.deployedSites, site];
          break;
        }
      }

      return newState;
    }
  }
}

export function usePipelineState() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleEvent = useCallback((event: DashboardEvent) => {
    dispatch({ type: "event", event });
  }, []);

  const setConnected = useCallback((connected: boolean) => {
    dispatch({ type: "set_connected", connected });
  }, []);

  return { state, handleEvent, setConnected };
}

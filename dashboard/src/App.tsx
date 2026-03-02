import { useEffect, useMemo, useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { usePipelineState } from "./hooks/usePipelineState";
import { useDarkMode } from "./hooks/useDarkMode";
import { DashboardShell } from "./components/layout/DashboardShell";
import { PipelineFlow } from "./components/pipeline/PipelineFlow";
import { AgentDetailPanel } from "./components/pipeline/AgentDetailPanel";
import { LaunchButton } from "./components/pipeline/LaunchButton";
import { DeployedSites } from "./components/pipeline/DeployedSites";
import { ActivityFeed } from "./components/feed/ActivityFeed";
import { LogsPanel } from "./components/feed/LogsPanel";
import { StatsBar } from "./components/stats/StatsBar";
import { FloatingBubble } from "./components/shared/FloatingBubble";
import type { AgentName, LogEntry } from "./lib/types";

export default function App() {
  const { state, handleEvent, setConnected } = usePipelineState();
  const { connected } = useWebSocket(handleEvent);
  const { dark, toggle: toggleDark } = useDarkMode();
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);

  const agentLogs = useMemo(() => {
    if (!selectedAgent) return [];
    return state.logs.filter((log) => logMatchesAgent(log, selectedAgent));
  }, [state.logs, selectedAgent]);

  const agentSteps = useMemo(() => {
    if (!selectedAgent) return [];
    return state.feed.filter((entry) => entry.agent === selectedAgent);
  }, [state.feed, selectedAgent]);

  useEffect(() => {
    setConnected(connected);
  }, [connected, setConnected]);

  return (
    <DashboardShell
      connected={connected}
      dark={dark}
      onToggleDark={toggleDark}
      feed={<ActivityFeed entries={state.feed} />}
      logs={<LogsPanel logs={state.logs} />}
      stats={<StatsBar stats={state.stats} health={state.health} />}
    >
      <FloatingBubble />
      <div className="flex flex-col items-center h-full">
        <div className="flex-1 w-full">
          <PipelineFlow
            state={state}
            onAgentClick={(agentName) => setSelectedAgent(agentName)}
          />
        </div>
        <DeployedSites sites={state.deployedSites} />
        <div className="pb-4 sm:pb-6">
          <LaunchButton
            status={state.pipelineRunStatus}
            message={state.pipelineRunMessage}
            connected={connected}
          />
        </div>
      </div>
      <AgentDetailPanel
        agent={selectedAgent ? state.agents[selectedAgent] : null}
        logs={agentLogs}
        steps={agentSteps}
        onClose={() => setSelectedAgent(null)}
      />
    </DashboardShell>
  );
}

function logMatchesAgent(log: LogEntry, agent: AgentName): boolean {
  const source = log.source?.toLowerCase() ?? "";
  if (source.includes("agent 0.5")) return agent === "agent-0.5";
  if (source.includes("agent 1") || source === "googlekp") return agent === "agent-1";
  if (source.includes("agent 2")) return agent === "agent-2";
  if (source.includes("agent 3")) return agent === "agent-3";
  if (source.includes("agent 7")) return agent === "agent-7";
  return false;
}

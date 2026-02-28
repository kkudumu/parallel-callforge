import { useEffect } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { usePipelineState } from "./hooks/usePipelineState";
import { useDarkMode } from "./hooks/useDarkMode";
import { DashboardShell } from "./components/layout/DashboardShell";
import { PipelineFlow } from "./components/pipeline/PipelineFlow";
import { LaunchButton } from "./components/pipeline/LaunchButton";
import { DeployedSites } from "./components/pipeline/DeployedSites";
import { ActivityFeed } from "./components/feed/ActivityFeed";
import { LogsPanel } from "./components/feed/LogsPanel";
import { StatsBar } from "./components/stats/StatsBar";
import { FloatingBubble } from "./components/shared/FloatingBubble";

export default function App() {
  const { state, handleEvent, setConnected } = usePipelineState();
  const { connected } = useWebSocket(handleEvent);
  const { dark, toggle: toggleDark } = useDarkMode();

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
          <PipelineFlow state={state} />
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
    </DashboardShell>
  );
}

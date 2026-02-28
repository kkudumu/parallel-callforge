import { AgentNode } from "./AgentNode";
import { ConnectionLine } from "./ConnectionLine";
import { AGENTS } from "../../lib/constants";
import type { PipelineState } from "../../lib/types";

interface PipelineFlowProps {
  state: PipelineState;
}

export function PipelineFlow({ state }: PipelineFlowProps) {
  const agent1 = state.agents["agent-1"];
  const agent2 = state.agents["agent-2"];
  const agent3 = state.agents["agent-3"];
  const agent7 = state.agents["agent-7"];

  return (
    <div className="relative w-full h-full flex items-center justify-center p-4 sm:p-6">
      {/* Desktop layout: horizontal flow */}
      <div className="hidden sm:flex relative flex-col items-center gap-6 w-full">
        {/* Connection lines (desktop) */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: "visible" }}>
          {/* Agent 1 -> Agent 2 */}
          <DesktopConnection
            x1="22%" x2="47%"
            y="35%"
            status={agent1.status === "completed" ? agent2.status : "idle"}
            color={AGENTS["agent-2"].color}
          />
          {/* Agent 2 -> Agent 3 */}
          <DesktopConnection
            x1="53%" x2="78%"
            y="35%"
            status={agent2.status === "completed" ? agent3.status : "idle"}
            color={AGENTS["agent-3"].color}
          />
        </svg>

        {/* Top row: Agent 1 -> Agent 2 -> Agent 3 */}
        <div className="flex items-start justify-center gap-10 lg:gap-16 w-full relative z-10">
          <AgentNode agent={agent1} />
          <AgentNode agent={agent2} />
          <AgentNode agent={agent3} />
        </div>

        {/* Bottom row: Agent 7 */}
        <div className="flex items-center gap-3 relative z-10">
          <svg width="40" height="30" className="text-kawaii-peach dark:text-kawaii-peach-dark opacity-40">
            <path d="M20 0 L20 30" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
          </svg>
          <AgentNode agent={agent7} />
        </div>
      </div>

      {/* Mobile layout: vertical flow */}
      <div className="sm:hidden flex flex-col items-center gap-2 w-full">
        <AgentNode agent={agent1} />
        <MobileConnector
          status={agent1.status === "completed" ? agent2.status : "idle"}
          color={AGENTS["agent-2"].color}
        />
        <AgentNode agent={agent2} />
        <MobileConnector
          status={agent2.status === "completed" ? agent3.status : "idle"}
          color={AGENTS["agent-3"].color}
        />
        <AgentNode agent={agent3} />
        <MobileConnector
          status={agent3.status === "completed" ? agent7.status : "idle"}
          color={AGENTS["agent-7"].color}
        />
        <AgentNode agent={agent7} />
      </div>
    </div>
  );
}

// Simplified horizontal connection for desktop
function DesktopConnection({ x1, x2, y, status, color }: {
  x1: string; x2: string; y: string;
  status: string; color: string;
}) {
  const isActive = status === "running" || status === "completed";
  return (
    <line
      x1={x1} y1={y}
      x2={x2} y2={y}
      stroke={isActive ? color : document.documentElement.classList.contains("dark") ? "#3d2a55" : "#E8D4FF"}
      strokeWidth={2.5}
      strokeLinecap="round"
      opacity={isActive ? 0.6 : 0.3}
      strokeDasharray={status === "running" ? "6 8" : "none"}
    >
      {status === "running" && (
        <animate attributeName="stroke-dashoffset" values="0;-28" dur="1s" repeatCount="indefinite" />
      )}
    </line>
  );
}

// Vertical connector for mobile
function MobileConnector({ status, color }: { status: string; color: string }) {
  const isActive = status === "running" || status === "completed";
  return (
    <div className="flex flex-col items-center">
      <svg width="20" height="24" style={{ overflow: "visible" }}>
        <line
          x1="10" y1="0" x2="10" y2="24"
          stroke={isActive ? color : document.documentElement.classList.contains("dark") ? "#3d2a55" : "#E8D4FF"}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={isActive ? 0.7 : 0.3}
          strokeDasharray={status === "running" ? "4 4" : "none"}
        >
          {status === "running" && (
            <animate attributeName="stroke-dashoffset" values="0;-16" dur="0.8s" repeatCount="indefinite" />
          )}
        </line>
        {status === "running" && (
          <circle r="3" fill={color} opacity="0.8">
            <animate attributeName="cy" values="0;24" dur="1s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;1;0" dur="1s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
    </div>
  );
}

import { motion } from "framer-motion";
import { AgentAvatar } from "./AgentAvatar";
import { PulseRing } from "../shared/PulseRing";
import { SparkleEffect } from "../shared/SparkleEffect";
import { AGENTS } from "../../lib/constants";
import {
  idleBreathing,
  workingBounce,
  successPop,
  errorShake,
} from "../../lib/animations";
import type { AgentState } from "../../lib/types";

interface AgentNodeProps {
  agent: AgentState;
  onClick?: () => void;
}

function getAnimation(status: string) {
  switch (status) {
    case "idle":
      return idleBreathing;
    case "running":
      return workingBounce;
    case "completed":
      return successPop;
    case "error":
      return errorShake;
    default:
      return idleBreathing;
  }
}

export function AgentNode({ agent, onClick }: AgentNodeProps) {
  const meta = AGENTS[agent.name];
  const animation = getAnimation(agent.status);

  return (
    <div
      className="relative flex flex-col sm:flex-col items-center cursor-pointer"
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {/* Mobile: horizontal card layout */}
      <div className="sm:hidden flex items-center gap-3 px-4 py-2 rounded-kawaii-lg w-full max-w-xs" style={{ backgroundColor: `${meta.color}18` }}>
        {/* Pulse ring for active agents */}
        {agent.status === "running" && (
          <div className="absolute left-6 top-1/2 -translate-y-1/2">
            <PulseRing color={meta.color} size={50} />
          </div>
        )}

        <motion.div animate={animation} className="relative z-10 flex-shrink-0">
          <div className="rounded-full p-1.5" style={{ backgroundColor: `${meta.color}30` }}>
            <AgentAvatar agent={agent.name} status={agent.status} size={40} />
          </div>
        </motion.div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm text-kawaii-text dark:text-[#e0d4f0]">{meta.label}</span>
            <span className="text-[10px] text-kawaii-text-muted dark:text-[#9a8ab0]">{meta.role}</span>
          </div>
          <motion.div
            key={agent.currentStep}
            initial={{ opacity: 0, x: 5 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-xs font-semibold truncate"
            style={{ color: meta.colorDark }}
          >
            {agent.currentStep || (agent.status === "idle" ? "Waiting..." : agent.status)}
          </motion.div>
          {agent.currentDetail && (
            <div className="text-[10px] text-kawaii-text-muted dark:text-[#9a8ab0] leading-tight break-words">
              {agent.currentDetail}
            </div>
          )}
        </div>

        {/* Sparkle on completion */}
        {agent.status === "completed" && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <SparkleEffect color={meta.colorDark} count={6} />
          </div>
        )}
      </div>

      {/* Desktop: vertical card layout */}
      <div className="hidden sm:flex flex-col items-center">
        {/* Pulse ring for active agents */}
        {agent.status === "running" && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%]">
            <PulseRing color={meta.color} />
          </div>
        )}

        {/* Sparkle burst on completion */}
        {agent.status === "completed" && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%]">
            <SparkleEffect color={meta.colorDark} />
          </div>
        )}

        {/* Avatar with animations */}
        <motion.div
          animate={animation}
          className="relative cursor-pointer z-10"
        >
          <div
            className="rounded-full p-3 shadow-kawaii transition-shadow hover:shadow-kawaii-hover"
            style={{ backgroundColor: `${meta.color}30` }}
          >
            <AgentAvatar agent={agent.name} status={agent.status} size={64} />
          </div>
        </motion.div>

        {/* Agent label */}
        <motion.div
          className="mt-2 text-center"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="font-bold text-sm text-kawaii-text dark:text-[#e0d4f0]">{meta.label}</div>
          <div className="text-xs text-kawaii-text-muted dark:text-[#9a8ab0]">{meta.role}</div>
        </motion.div>

        {/* Status badge */}
        <motion.div
          key={agent.currentStep}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-1 px-3 py-0.5 rounded-full text-xs font-semibold max-w-[140px] truncate"
          style={{
            backgroundColor: `${meta.color}40`,
            color: meta.colorDark,
          }}
        >
          {agent.currentStep || (agent.status === "idle" ? "Waiting..." : agent.status)}
        </motion.div>

        {/* Detail text */}
        {agent.currentDetail && (
          <motion.div
            key={agent.currentDetail}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[10px] text-kawaii-text-muted dark:text-[#9a8ab0] mt-0.5 max-w-[180px] text-center leading-tight break-words"
          >
            {agent.currentDetail}
          </motion.div>
        )}
      </div>
    </div>
  );
}

import { motion } from "framer-motion";
import type { AgentStatus } from "../../lib/types";

interface ConnectionLineProps {
  from: { x: number; y: number };
  to: { x: number; y: number };
  status: AgentStatus;
  color: string;
  curved?: boolean;
}

export function ConnectionLine({ from, to, status, color, curved = false }: ConnectionLineProps) {
  const isActive = status === "running" || status === "completed";

  const pathD = curved
    ? `M${from.x},${from.y} Q${(from.x + to.x) / 2},${from.y + 40} ${to.x},${to.y}`
    : `M${from.x},${from.y} L${to.x},${to.y}`;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
    >
      {/* Base line */}
      <path
        d={pathD}
        fill="none"
        stroke={isActive ? color : "#E8D4FF"}
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={isActive ? 0.6 : 0.3}
      />

      {/* Marching ants overlay */}
      {status === "running" && (
        <motion.path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeDasharray="6 8"
          strokeLinecap="round"
          animate={{
            strokeDashoffset: [0, -28],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      )}

      {/* Travelling data dot */}
      {status === "running" && (
        <>
          <circle r={0} fill={color}>
            <animateMotion
              dur="1.5s"
              repeatCount="indefinite"
              path={pathD}
            />
            <animate
              attributeName="r"
              values="0;4;4;4;0"
              dur="1.5s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;1;0"
              dur="1.5s"
              repeatCount="indefinite"
            />
          </circle>
          {/* Glow effect */}
          <circle r={0} fill={color} opacity={0.3}>
            <animateMotion
              dur="1.5s"
              repeatCount="indefinite"
              path={pathD}
            />
            <animate
              attributeName="r"
              values="0;8;8;8;0"
              dur="1.5s"
              repeatCount="indefinite"
            />
          </circle>
        </>
      )}

      {/* Completion sparkle line */}
      {status === "completed" && (
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          opacity={0.5}
        />
      )}
    </svg>
  );
}

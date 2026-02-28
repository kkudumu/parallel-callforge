import type { AgentName, AgentStatus } from "../../lib/types";
import { AGENTS } from "../../lib/constants";

interface AgentAvatarProps {
  agent: AgentName;
  status: AgentStatus;
  size?: number;
}

function getExpression(status: AgentStatus) {
  switch (status) {
    case "idle":
      return { leftEye: "open", rightEye: "open", mouth: "neutral" };
    case "running":
      return { leftEye: "open", rightEye: "wink", mouth: "smile" };
    case "completed":
      return { leftEye: "happy", rightEye: "happy", mouth: "grin" };
    case "error":
      return { leftEye: "sad", rightEye: "sad", mouth: "frown" };
  }
}

function Eye({ type, cx, cy }: { type: string; cx: number; cy: number }) {
  switch (type) {
    case "open":
      return <circle cx={cx} cy={cy} r={3} fill="#4A3560" />;
    case "wink":
      return (
        <path
          d={`M${cx - 3} ${cy} Q${cx} ${cy - 3} ${cx + 3} ${cy}`}
          fill="none"
          stroke="#4A3560"
          strokeWidth={2}
          strokeLinecap="round"
        />
      );
    case "happy":
      return (
        <path
          d={`M${cx - 3} ${cy - 1} Q${cx} ${cy + 3} ${cx + 3} ${cy - 1}`}
          fill="none"
          stroke="#4A3560"
          strokeWidth={2}
          strokeLinecap="round"
        />
      );
    case "sad":
      return (
        <>
          <circle cx={cx} cy={cy} r={3} fill="#4A3560" />
          <circle cx={cx + 2} cy={cy + 4} r={1.5} fill="#B5D8FF" opacity={0.8} />
        </>
      );
    default:
      return <circle cx={cx} cy={cy} r={3} fill="#4A3560" />;
  }
}

function Mouth({ type, cx, cy }: { type: string; cx: number; cy: number }) {
  switch (type) {
    case "smile":
      return (
        <path
          d={`M${cx - 4} ${cy} Q${cx} ${cy + 4} ${cx + 4} ${cy}`}
          fill="none"
          stroke="#4A3560"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      );
    case "grin":
      return (
        <path
          d={`M${cx - 5} ${cy - 1} Q${cx} ${cy + 5} ${cx + 5} ${cy - 1}`}
          fill="none"
          stroke="#4A3560"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      );
    case "frown":
      return (
        <path
          d={`M${cx - 4} ${cy + 2} Q${cx} ${cy - 2} ${cx + 4} ${cy + 2}`}
          fill="none"
          stroke="#4A3560"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      );
    default:
      return (
        <line
          x1={cx - 3}
          y1={cy}
          x2={cx + 3}
          y2={cy}
          stroke="#4A3560"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      );
  }
}

function Accessory({ type, color }: { type: string; color: string }) {
  switch (type) {
    case "magnifying-glass":
      return (
        <g transform="translate(50, 8) rotate(-20)">
          <circle cx={0} cy={0} r={6} fill="none" stroke={color} strokeWidth={2} />
          <line x1={4} y1={4} x2={10} y2={10} stroke={color} strokeWidth={2} strokeLinecap="round" />
        </g>
      );
    case "paintbrush":
      return (
        <g transform="translate(48, 5) rotate(-30)">
          <rect x={-2} y={0} width={4} height={14} rx={1} fill="#8B7AA0" />
          <rect x={-3} y={-4} width={6} height={5} rx={2} fill={color} />
        </g>
      );
    case "hard-hat":
      return (
        <g transform="translate(30, 5)">
          <path d="M-12 8 Q0 -8 12 8" fill={color} stroke={color} strokeWidth={1} />
          <rect x={-14} y={7} width={28} height={3} rx={1.5} fill={color} />
        </g>
      );
    case "stethoscope":
      return (
        <g transform="translate(48, 15)">
          <path d="M0 0 Q8 -8 8 0 Q8 10 0 14" fill="none" stroke={color} strokeWidth={2} />
          <circle cx={0} cy={16} r={3} fill={color} />
        </g>
      );
    default:
      return null;
  }
}

function Blush({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return <ellipse cx={cx} cy={cy} rx={5} ry={3} fill={color} opacity={0.4} />;
}

export function AgentAvatar({ agent, status, size = 60 }: AgentAvatarProps) {
  const meta = AGENTS[agent];
  const expr = getExpression(status);
  const scale = size / 60;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 60 60"
      style={{ transform: `scale(${scale > 1 ? 1 : scale})`, overflow: "visible" }}
    >
      {/* Body circle */}
      <circle cx={30} cy={32} r={22} fill={meta.colorLight} stroke={meta.color} strokeWidth={2} />

      {/* Blush marks */}
      <Blush cx={17} cy={37} color={meta.colorDark} />
      <Blush cx={43} cy={37} color={meta.colorDark} />

      {/* Eyes */}
      <Eye type={expr.leftEye} cx={23} cy={30} />
      <Eye type={expr.rightEye} cx={37} cy={30} />

      {/* Mouth */}
      <Mouth type={expr.mouth} cx={30} cy={39} />

      {/* Accessory */}
      <Accessory type={meta.accessory} color={meta.colorDark} />
    </svg>
  );
}

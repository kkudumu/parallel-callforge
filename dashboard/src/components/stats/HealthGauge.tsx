import { motion } from "framer-motion";
import { springs } from "../../lib/animations";
import type { HealthScore } from "../../lib/types";

interface HealthGaugeProps {
  health: HealthScore;
  size?: number;
}

function getFaceExpression(score: number) {
  if (score >= 80) return { eyes: "happy", mouth: "grin" };
  if (score >= 50) return { eyes: "open", mouth: "neutral" };
  return { eyes: "sad", mouth: "frown" };
}

function getGaugeColor(score: number) {
  if (score >= 80) return "#7DCEA0";
  if (score >= 50) return "#F9E79F";
  return "#F1948A";
}

export function HealthGauge({ health, size = 72 }: HealthGaugeProps) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (health.score / 100) * circumference;
  const face = getFaceExpression(health.score);
  const gaugeColor = getGaugeColor(health.score);
  const center = size / 2;
  const faceStroke = "#4A3560";

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            className="stroke-[#F0E4FF] dark:stroke-[#3d2a55]"
            strokeWidth={5}
          />
          {/* Progress arc */}
          <motion.circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={gaugeColor}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - progress }}
            transition={springs.counter}
            transform={`rotate(-90 ${center} ${center})`}
          />

          {/* Chibi face */}
          {/* Eyes */}
          {face.eyes === "happy" ? (
            <>
              <path d={`M${center - 8} ${center - 3} Q${center - 5} ${center + 2} ${center - 2} ${center - 3}`} fill="none" className="stroke-kawaii-text dark:stroke-[#e0d4f0]" strokeWidth={1.5} strokeLinecap="round" />
              <path d={`M${center + 2} ${center - 3} Q${center + 5} ${center + 2} ${center + 8} ${center - 3}`} fill="none" className="stroke-kawaii-text dark:stroke-[#e0d4f0]" strokeWidth={1.5} strokeLinecap="round" />
            </>
          ) : (
            <>
              <circle cx={center - 5} cy={center - 3} r={2} className="fill-kawaii-text dark:fill-[#e0d4f0]" />
              <circle cx={center + 5} cy={center - 3} r={2} className="fill-kawaii-text dark:fill-[#e0d4f0]" />
            </>
          )}

          {/* Mouth */}
          {face.mouth === "grin" ? (
            <path d={`M${center - 5} ${center + 5} Q${center} ${center + 10} ${center + 5} ${center + 5}`} fill="none" className="stroke-kawaii-text dark:stroke-[#e0d4f0]" strokeWidth={1.5} strokeLinecap="round" />
          ) : face.mouth === "frown" ? (
            <path d={`M${center - 4} ${center + 7} Q${center} ${center + 3} ${center + 4} ${center + 7}`} fill="none" className="stroke-kawaii-text dark:stroke-[#e0d4f0]" strokeWidth={1.5} strokeLinecap="round" />
          ) : (
            <line x1={center - 3} y1={center + 5} x2={center + 3} y2={center + 5} className="stroke-kawaii-text dark:stroke-[#e0d4f0]" strokeWidth={1.5} strokeLinecap="round" />
          )}

          {/* Blush */}
          <ellipse cx={center - 10} cy={center + 3} rx={3} ry={1.5} fill={gaugeColor} opacity={0.4} />
          <ellipse cx={center + 10} cy={center + 3} rx={3} ry={1.5} fill={gaugeColor} opacity={0.4} />
        </svg>
      </div>

      <div className="text-right">
        <motion.div
          key={health.score}
          initial={{ y: -5, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={springs.counter}
          className="font-extrabold text-lg leading-none"
          style={{ color: gaugeColor }}
        >
          {health.score}
        </motion.div>
        <div className="text-[10px] text-kawaii-text-muted dark:text-[#9a8ab0] font-semibold">
          {health.interpretation}
        </div>
      </div>
    </div>
  );
}

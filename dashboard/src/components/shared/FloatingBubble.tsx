import { motion } from "framer-motion";
import { floatingBubbleVariants } from "../../lib/animations";

interface FloatingBubbleProps {
  count?: number;
}

const BUBBLE_COLORS_LIGHT = [
  "rgba(255, 181, 194, 0.15)",
  "rgba(181, 216, 255, 0.15)",
  "rgba(181, 255, 207, 0.15)",
  "rgba(255, 212, 181, 0.15)",
  "rgba(232, 212, 255, 0.15)",
];

const BUBBLE_COLORS_DARK = [
  "rgba(255, 181, 194, 0.08)",
  "rgba(181, 216, 255, 0.08)",
  "rgba(181, 255, 207, 0.08)",
  "rgba(255, 212, 181, 0.08)",
  "rgba(232, 212, 255, 0.08)",
];

export function FloatingBubble({ count = 7 }: FloatingBubbleProps) {
  const isDark = document.documentElement.classList.contains("dark");
  const colors = isDark ? BUBBLE_COLORS_DARK : BUBBLE_COLORS_LIGHT;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          custom={i}
          variants={floatingBubbleVariants}
          animate="animate"
          className="absolute rounded-full"
          style={{
            width: 20 + Math.random() * 40,
            height: 20 + Math.random() * 40,
            backgroundColor: colors[i % colors.length],
            left: `${10 + (i * 13) % 80}%`,
            top: `${15 + (i * 17) % 70}%`,
          }}
        />
      ))}
    </div>
  );
}

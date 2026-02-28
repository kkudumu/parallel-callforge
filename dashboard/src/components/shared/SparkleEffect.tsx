import { motion } from "framer-motion";
import { sparkleVariants } from "../../lib/animations";

interface SparkleEffectProps {
  color: string;
  count?: number;
}

export function SparkleEffect({ color, count = 10 }: SparkleEffectProps) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          custom={i}
          variants={sparkleVariants}
          initial="initial"
          animate="animate"
          className="absolute left-1/2 top-1/2"
          style={{
            width: 6 + Math.random() * 4,
            height: 6 + Math.random() * 4,
            backgroundColor: color,
            clipPath: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
          }}
        />
      ))}
    </div>
  );
}

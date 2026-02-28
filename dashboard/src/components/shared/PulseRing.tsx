import { motion } from "framer-motion";
import { pulseRingVariants } from "../../lib/animations";

interface PulseRingProps {
  color: string;
  size?: number;
}

export function PulseRing({ color, size = 80 }: PulseRingProps) {
  return (
    <div className="absolute pointer-events-none" style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          variants={pulseRingVariants}
          animate="animate"
          className="absolute inset-0 rounded-full border-2"
          style={{
            borderColor: color,
            animationDelay: `${i * 0.5}s`,
          }}
          transition={{
            delay: i * 0.5,
          }}
        />
      ))}
    </div>
  );
}

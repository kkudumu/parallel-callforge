import type { Variants, Transition } from "framer-motion";

// Spring presets
export const springs = {
  bouncy: { type: "spring" as const, stiffness: 300, damping: 15 },
  gentle: { type: "spring" as const, stiffness: 150, damping: 20 },
  snappy: { type: "spring" as const, stiffness: 400, damping: 25 },
  counter: { type: "spring" as const, stiffness: 100, damping: 15 },
} satisfies Record<string, Transition>;

// Idle breathing animation
export const idleBreathing = {
  y: [0, -4, 0],
  transition: {
    duration: 3,
    repeat: Infinity,
    ease: "easeInOut",
  },
};

// Working bounce animation
export const workingBounce = {
  y: [0, -6, 0],
  scale: [1, 1.03, 1],
  transition: {
    duration: 0.8,
    repeat: Infinity,
    ease: "easeInOut",
  },
};

// Success pop animation
export const successPop = {
  scale: [1, 1.2, 0.95, 1.05, 1],
  transition: {
    duration: 0.6,
    ease: "easeOut",
  },
};

// Error shake animation
export const errorShake = {
  x: [0, -8, 8, -6, 6, -3, 3, 0],
  transition: {
    duration: 0.5,
    ease: "easeOut",
  },
};

// Feed entry animation
export const feedEntryVariants: Variants = {
  initial: { x: 40, opacity: 0 },
  animate: {
    x: 0,
    opacity: 1,
    transition: springs.bouncy,
  },
  exit: { x: -20, opacity: 0, transition: { duration: 0.2 } },
};

// Pulse ring animation
export const pulseRingVariants: Variants = {
  animate: {
    scale: [1, 1.5, 2],
    opacity: [0.4, 0.2, 0],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "easeOut",
    },
  },
};

// Floating bubble animation
export const floatingBubbleVariants: Variants = {
  animate: (i: number) => ({
    y: [0, -20, 0, 10, 0],
    x: [0, 8, -5, 3, 0],
    transition: {
      duration: 6,
      repeat: Infinity,
      delay: i * 0.8,
      ease: "easeInOut",
    },
  }),
};

// Sparkle animation
export const sparkleVariants: Variants = {
  initial: { scale: 0, opacity: 1 },
  animate: (i: number) => {
    const angle = (i / 10) * Math.PI * 2;
    const distance = 30 + Math.random() * 20;
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      scale: [0, 1.2, 0],
      opacity: [1, 1, 0],
      transition: {
        duration: 0.8,
        ease: "easeOut",
        delay: i * 0.03,
      },
    };
  },
};

// Marching ants
export const marchingAnts = {
  strokeDashoffset: [0, -20],
  transition: {
    duration: 1,
    repeat: Infinity,
    ease: "linear" as const,
  },
};

// Data dot travel
export const dataDotTravel = {
  offsetDistance: ["0%", "100%"],
  transition: {
    duration: 1.5,
    repeat: Infinity,
    ease: "easeInOut" as const,
  },
};

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { PipelineRunStatus } from "../../lib/types";

interface LaunchButtonProps {
  status: PipelineRunStatus;
  message: string;
  connected: boolean;
}

export function LaunchButton({ status, message, connected }: LaunchButtonProps) {
  const [launching, setLaunching] = useState(false);

  const handleLaunch = async () => {
    if (status === "running" || launching || !connected) return;

    setLaunching(true);
    try {
      const res = await fetch("/api/pipeline/start", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        console.error("Launch failed:", data.error);
      }
    } catch (err) {
      console.error("Launch failed:", err);
    } finally {
      setLaunching(false);
    }
  };

  const isRunning = status === "running" || launching;
  const isDone = status === "completed";
  const isError = status === "error";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <motion.button
        onClick={handleLaunch}
        disabled={isRunning || !connected}
        whileHover={!isRunning && connected ? { scale: 1.05 } : {}}
        whileTap={!isRunning && connected ? { scale: 0.95 } : {}}
        className={`
          relative flex items-center gap-2 px-5 py-2.5 sm:px-6 sm:py-3
          rounded-kawaii-lg font-bold text-sm sm:text-base
          shadow-kawaii transition-all duration-200
          ${isRunning
            ? "bg-kawaii-sky text-white cursor-wait"
            : isDone
              ? "bg-emerald-400 text-white hover:bg-emerald-500"
              : isError
                ? "bg-red-400 text-white hover:bg-red-500"
                : connected
                  ? "bg-gradient-to-r from-kawaii-pink to-kawaii-lavender-dark text-white hover:shadow-kawaii-hover cursor-pointer"
                  : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
          }
        `}
      >
        <AnimatePresence mode="wait">
          {isRunning ? (
            <motion.div
              key="running"
              initial={{ rotate: 0 }}
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            >
              <Loader2 size={18} />
            </motion.div>
          ) : isDone ? (
            <motion.div
              key="done"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
            >
              <CheckCircle2 size={18} />
            </motion.div>
          ) : isError ? (
            <motion.div
              key="error"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
            >
              <AlertCircle size={18} />
            </motion.div>
          ) : (
            <motion.div
              key="play"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
            >
              <Play size={18} fill="currentColor" />
            </motion.div>
          )}
        </AnimatePresence>

        <span>
          {isRunning
            ? "Running..."
            : isDone
              ? "Run Again"
              : isError
                ? "Retry"
                : "Launch Pipeline"
          }
        </span>

        {/* Pulsing ring when idle */}
        {!isRunning && !isDone && !isError && connected && (
          <motion.div
            className="absolute inset-0 rounded-kawaii-lg border-2 border-kawaii-pink"
            animate={{
              scale: [1, 1.08, 1],
              opacity: [0.5, 0, 0.5],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}
      </motion.button>

      {/* Status message */}
      <AnimatePresence>
        {message && status !== "idle" && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`text-[11px] font-semibold text-center max-w-[250px] truncate ${
              isError ? "text-red-500 dark:text-red-400" : isDone ? "text-emerald-600 dark:text-emerald-400" : "text-kawaii-text-muted dark:text-[#9a8ab0]"
            }`}
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

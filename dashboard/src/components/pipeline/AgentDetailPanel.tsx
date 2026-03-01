import { useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import type { AgentState, FeedEntry, LogEntry } from "../../lib/types";
import { AGENTS } from "../../lib/constants";

interface AgentDetailPanelProps {
  agent: AgentState | null;
  logs: LogEntry[];
  steps: FeedEntry[];
  onClose: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function AgentDetailPanel({ agent, logs, steps, onClose }: AgentDetailPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const meta = agent ? AGENTS[agent.name] : null;

  const stepEntries = useMemo(() => steps.slice(0, 12), [steps]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length]);

  return (
    <AnimatePresence>
      {agent && meta && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
        >
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 24 }}
            className="w-full max-w-3xl bg-white/95 dark:bg-[#1c1428]/95 border border-kawaii-lavender/30 dark:border-[#3d2a55]/60 rounded-kawaii-lg shadow-kawaii overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-kawaii-lavender/20 dark:border-[#3d2a55]/50">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: meta.color }} />
                <div>
                  <div className="text-sm font-bold text-kawaii-text dark:text-[#e0d4f0]">
                    {meta.label}
                  </div>
                  <div className="text-[11px] text-kawaii-text-muted dark:text-[#9a8ab0]">
                    {meta.role}
                  </div>
                </div>
                <div className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                  style={{ backgroundColor: `${meta.color}25`, color: meta.colorDark }}
                >
                  {agent.status}
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <X size={16} className="text-kawaii-text-muted dark:text-[#9a8ab0]" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr] gap-4 p-4 sm:p-5">
              <div className="space-y-4">
                <div className="rounded-kawaii bg-kawaii-lavender/15 dark:bg-[#281a3b] border border-kawaii-lavender/20 dark:border-[#3d2a55]/60 p-3">
                  <div className="text-[11px] font-semibold text-kawaii-text-muted dark:text-[#9a8ab0]">
                    Current step
                  </div>
                  <div className="text-sm font-semibold text-kawaii-text dark:text-[#e0d4f0] mt-1">
                    {agent.currentStep || "Waiting..."}
                  </div>
                  {agent.currentDetail && (
                    <div className="text-xs text-kawaii-text-muted dark:text-[#9a8ab0] mt-1">
                      {agent.currentDetail}
                    </div>
                  )}
                  {agent.status === "running" && (
                    <div className="flex items-center gap-2 mt-2 text-[11px] text-kawaii-text-muted dark:text-[#9a8ab0]">
                      <Loader2 size={12} className="animate-spin" />
                      Processing live output…
                    </div>
                  )}
                </div>

                <div className="rounded-kawaii bg-white/70 dark:bg-[#221635] border border-kawaii-lavender/20 dark:border-[#3d2a55]/60 p-3">
                  <div className="text-[11px] font-semibold text-kawaii-text-muted dark:text-[#9a8ab0] mb-2">
                    Recent steps
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {stepEntries.length === 0 && (
                      <div className="text-xs text-kawaii-text-muted dark:text-[#9a8ab0]">
                        No steps yet. Start the pipeline to see activity.
                      </div>
                    )}
                    {stepEntries.map((entry) => (
                      <div key={entry.id} className="text-xs text-kawaii-text dark:text-[#e0d4f0]">
                        <span className="text-[10px] text-kawaii-text-muted dark:text-[#9a8ab0] mr-2">
                          {formatTime(entry.timestamp)}
                        </span>
                        {entry.message}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-kawaii bg-[#0d0d1a] border border-[#2a2a4a] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-[#1a1a2e] border-b border-[#2a2a4a]">
                  <span className="text-[10px] text-gray-500 font-mono">
                    live output — {logs.length} lines
                  </span>
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                  </div>
                </div>
                <div
                  ref={containerRef}
                  className="max-h-64 sm:max-h-72 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed space-y-px"
                >
                  {logs.length === 0 && (
                    <div className="text-gray-600 py-6 text-center">
                      No output yet for this agent.
                    </div>
                  )}
                  {logs.map((log) => (
                    <div key={log.id} className="flex gap-2 text-gray-300">
                      <span className="text-gray-600 flex-shrink-0 w-16">
                        {formatTime(log.timestamp)}
                      </span>
                      <span className="break-all">
                        {log.source ? log.message.replace(`[${log.source}] `, "") : log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

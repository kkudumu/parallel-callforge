import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LogEntry } from "../../lib/types";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";

interface LogsPanelProps {
  logs: LogEntry[];
}

function getLevelIcon(level: string) {
  switch (level) {
    case "error": return <AlertCircle size={11} className="text-red-400 flex-shrink-0" />;
    case "warn": return <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />;
    default: return <Info size={11} className="text-sky-400 flex-shrink-0" />;
  }
}

function getLevelColor(level: string) {
  switch (level) {
    case "error": return "text-red-300";
    case "warn": return "text-amber-300";
    default: return "text-gray-300 dark:text-gray-400";
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function LogsPanel({ logs }: LogsPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive, but only if already at bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length]);

  return (
    <div className="flex flex-col h-full bg-[#0d0d1a] dark:bg-[#0d0d1a] rounded-b-kawaii overflow-hidden">
      {/* Terminal header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1a2e] border-b border-[#2a2a4a]">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
        </div>
        <span className="text-[10px] text-gray-500 font-mono ml-1">
          callforge &mdash; {logs.length} lines
        </span>
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed space-y-px"
      >
        <AnimatePresence initial={false}>
          {logs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-start gap-1.5 py-px hover:bg-white/5 px-1 rounded"
            >
              <span className="text-gray-600 flex-shrink-0 select-none w-16">
                {formatTime(log.timestamp)}
              </span>
              {getLevelIcon(log.level)}
              {log.source && (
                <span className="text-violet-400 flex-shrink-0">[{log.source}]</span>
              )}
              <span className={`${getLevelColor(log.level)} break-all`}>
                {log.source ? log.message.replace(`[${log.source}] `, "") : log.message}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        {logs.length === 0 && (
          <div className="flex items-center justify-center h-32 text-gray-600">
            No logs yet. Start the pipeline to see output.
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

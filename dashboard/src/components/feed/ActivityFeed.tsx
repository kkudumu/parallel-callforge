import { motion, AnimatePresence } from "framer-motion";
import { feedEntryVariants } from "../../lib/animations";
import { AGENTS } from "../../lib/constants";
import type { FeedEntry } from "../../lib/types";
import { Search, Palette, Hammer, Stethoscope, Compass, AlertCircle, CheckCircle2, Zap, BarChart3 } from "lucide-react";

interface ActivityFeedProps {
  entries: FeedEntry[];
}

function getIcon(entry: FeedEntry) {
  if (entry.agent) {
    switch (entry.agent) {
      case "agent-0.5": return <Compass size={12} />;
      case "agent-1": return <Search size={12} />;
      case "agent-2": return <Palette size={12} />;
      case "agent-3": return <Hammer size={12} />;
      case "agent-7": return <Stethoscope size={12} />;
    }
  }
  switch (entry.type) {
    case "agent_error": return <AlertCircle size={12} />;
    case "agent_complete": return <CheckCircle2 size={12} />;
    case "health_score": return <BarChart3 size={12} />;
    default: return <Zap size={12} />;
  }
}

function getAccentColor(entry: FeedEntry): string {
  if (entry.agent) return AGENTS[entry.agent].color;
  if (entry.type === "agent_error") return "#F1948A";
  if (entry.type === "agent_complete") return "#7DCEA0";
  return "#E8D4FF";
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ActivityFeed({ entries }: ActivityFeedProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-kawaii-lavender/30 dark:border-[#3d2a55]/50">
        <h2 className="font-bold text-sm text-kawaii-text dark:text-[#e0d4f0] flex items-center gap-2">
          <Zap size={14} className="text-kawaii-lavender-dark dark:text-[#c4b0e0]" />
          Activity
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              variants={feedEntryVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              layout
              className="flex items-start gap-2 p-2 rounded-kawaii text-xs"
              style={{
                backgroundColor: `${getAccentColor(entry)}15`,
              }}
            >
              <div
                className="flex-shrink-0 mt-0.5 rounded-full p-1"
                style={{
                  backgroundColor: `${getAccentColor(entry)}30`,
                  color: getAccentColor(entry),
                }}
              >
                {getIcon(entry)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-kawaii-text dark:text-[#e0d4f0] leading-tight truncate">
                  {entry.message}
                </div>
                <div className="text-[10px] text-kawaii-text-muted dark:text-[#9a8ab0] mt-0.5">
                  {formatTime(entry.timestamp)}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {entries.length === 0 && (
          <div className="flex items-center justify-center h-32 text-xs text-kawaii-text-muted dark:text-[#9a8ab0]">
            Waiting for events...
          </div>
        )}
      </div>
    </div>
  );
}

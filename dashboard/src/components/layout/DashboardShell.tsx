import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wifi, WifiOff, ChevronUp, ChevronDown, Moon, Sun } from "lucide-react";

type SidebarTab = "activity" | "logs";

interface DashboardShellProps {
  connected: boolean;
  dark: boolean;
  onToggleDark: () => void;
  children: React.ReactNode;
  feed: React.ReactNode;
  logs: React.ReactNode;
  stats: React.ReactNode;
}

export function DashboardShell({ connected, dark, onToggleDark, children, feed, logs, stats }: DashboardShellProps) {
  const [feedOpen, setFeedOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("activity");
  const [mobileTab, setMobileTab] = useState<SidebarTab>("activity");

  return (
    <div className="h-[100dvh] flex flex-col bg-kawaii-bg dark:bg-[#1a1225] font-nunito overflow-hidden transition-colors duration-300">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 sm:px-6 sm:py-3 bg-white/60 dark:bg-[#241832]/80 backdrop-blur-sm border-b border-kawaii-lavender/20 dark:border-[#3d2a55]/50 flex-shrink-0 transition-colors duration-300">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="text-lg sm:text-xl font-extrabold text-kawaii-text dark:text-[#e0d4f0] tracking-tight">
            CallForge
          </div>
          <div className="text-[10px] sm:text-xs text-kawaii-text-muted dark:text-[#9a8ab0] font-semibold px-2 py-0.5 rounded-full bg-kawaii-lavender/20 dark:bg-[#3d2a55]/60 hidden sm:block">
            Pipeline Dashboard
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Dark mode toggle */}
          <button
            onClick={onToggleDark}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-kawaii-lavender/20 dark:bg-[#3d2a55]/60 text-kawaii-text-muted dark:text-[#c4b0e0] hover:bg-kawaii-lavender/40 dark:hover:bg-[#3d2a55] transition-colors"
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Feed/Logs toggle (mobile only) */}
          <button
            onClick={() => setFeedOpen(!feedOpen)}
            className="sm:hidden flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-kawaii-lavender/20 dark:bg-[#3d2a55]/60 text-kawaii-text-muted dark:text-[#9a8ab0]"
          >
            {mobileTab === "activity" ? "Feed" : "Logs"}
            {feedOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>

          <motion.div
            animate={{
              scale: connected ? [1, 1.2, 1] : 1,
              opacity: connected ? 1 : 0.5,
            }}
            transition={{ duration: 2, repeat: connected ? Infinity : 0 }}
            className="flex items-center gap-1 sm:gap-1.5 text-xs font-semibold"
          >
            {connected ? (
              <>
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <Wifi size={14} className="text-green-500 dark:text-green-400" />
                <span className="text-green-600 dark:text-green-400 hidden sm:inline">Live</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <WifiOff size={14} className="text-red-400" />
                <span className="text-red-500 dark:text-red-400 hidden sm:inline">Offline</span>
              </>
            )}
          </motion.div>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex flex-col sm:flex-row overflow-hidden relative">
        {/* Pipeline area */}
        <div className="flex-1 relative overflow-auto">
          {children}
        </div>

        {/* Desktop sidebar with tabs */}
        <div className="hidden sm:flex w-72 border-l border-kawaii-lavender/20 dark:border-[#3d2a55]/50 bg-white/40 dark:bg-[#1e1430]/60 backdrop-blur-sm overflow-hidden flex-col transition-colors duration-300">
          {/* Tab bar */}
          <div className="flex border-b border-kawaii-lavender/20 dark:border-[#3d2a55]/50">
            <button
              onClick={() => setSidebarTab("activity")}
              className={`flex-1 py-2 text-xs font-bold transition-colors ${
                sidebarTab === "activity"
                  ? "text-kawaii-text dark:text-[#e0d4f0] border-b-2 border-kawaii-lavender-dark dark:border-[#c4b0e0]"
                  : "text-kawaii-text-muted dark:text-[#9a8ab0] hover:text-kawaii-text dark:hover:text-[#c4b0e0]"
              }`}
            >
              Activity
            </button>
            <button
              onClick={() => setSidebarTab("logs")}
              className={`flex-1 py-2 text-xs font-bold transition-colors ${
                sidebarTab === "logs"
                  ? "text-kawaii-text dark:text-[#e0d4f0] border-b-2 border-kawaii-lavender-dark dark:border-[#c4b0e0]"
                  : "text-kawaii-text-muted dark:text-[#9a8ab0] hover:text-kawaii-text dark:hover:text-[#c4b0e0]"
              }`}
            >
              Logs
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {sidebarTab === "activity" ? feed : logs}
          </div>
        </div>

        {/* Mobile bottom sheet */}
        <AnimatePresence>
          {feedOpen && (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="sm:hidden absolute inset-x-0 bottom-0 z-30 bg-white/95 dark:bg-[#1e1430]/95 backdrop-blur-md border-t border-kawaii-lavender/30 dark:border-[#3d2a55]/50 rounded-t-kawaii-lg shadow-kawaii"
              style={{ height: "55dvh" }}
            >
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setMobileTab("activity")}
                    className={`text-xs font-bold px-2 py-0.5 rounded-full transition-colors ${
                      mobileTab === "activity"
                        ? "bg-kawaii-lavender/30 dark:bg-[#3d2a55] text-kawaii-text dark:text-[#e0d4f0]"
                        : "text-kawaii-text-muted dark:text-[#9a8ab0]"
                    }`}
                  >
                    Activity
                  </button>
                  <button
                    onClick={() => setMobileTab("logs")}
                    className={`text-xs font-bold px-2 py-0.5 rounded-full transition-colors ${
                      mobileTab === "logs"
                        ? "bg-kawaii-lavender/30 dark:bg-[#3d2a55] text-kawaii-text dark:text-[#e0d4f0]"
                        : "text-kawaii-text-muted dark:text-[#9a8ab0]"
                    }`}
                  >
                    Logs
                  </button>
                </div>
                <div
                  className="cursor-pointer p-1"
                  onClick={() => setFeedOpen(false)}
                >
                  <ChevronDown size={16} className="text-kawaii-text-muted dark:text-[#9a8ab0]" />
                </div>
              </div>
              <div className="h-[calc(100%-40px)] overflow-hidden">
                {mobileTab === "activity" ? feed : logs}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Stats bar */}
      <div className="border-t border-kawaii-lavender/20 dark:border-[#3d2a55]/50 bg-white/60 dark:bg-[#241832]/80 backdrop-blur-sm flex-shrink-0 transition-colors duration-300">
        {stats}
      </div>
    </div>
  );
}

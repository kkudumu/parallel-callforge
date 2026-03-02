import { useEffect, useState } from "react";
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
  const [scanning, setScanning] = useState(false);
  const [forceKeywordRefresh, setForceKeywordRefresh] = useState(false);
  const [forceDesignRefresh, setForceDesignRefresh] = useState(false);
  const [enableAgent7, setEnableAgent7] = useState(false);
  const [citySource, setCitySource] = useState<"hardcoded" | "deployment_candidates">("deployment_candidates");
  const [offerId, setOfferId] = useState("");
  const [offerZipCodes, setOfferZipCodes] = useState("");
  const [ignoreIndexationKillSwitch, setIgnoreIndexationKillSwitch] = useState(false);
  const [payoutPerQualifiedCall, setPayoutPerQualifiedCall] = useState("85");
  const [scanTopN, setScanTopN] = useState("5");
  const [scanRunAgent1, setScanRunAgent1] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [killSwitchStatus, setKillSwitchStatus] = useState<{
    configured: boolean;
    supported: boolean;
    armed: boolean;
    ratio: number | null;
    eligiblePages: number;
    indexedPages: number;
    reason: string;
  } | null>(null);
  const [serverDefaults, setServerDefaults] = useState<{
    citySource: "hardcoded" | "deployment_candidates";
    defaultOfferId: string | null;
    searchConsoleEnabled: boolean;
    agent7Provider: string;
  } | null>(null);
  const [availableOffers, setAvailableOffers] = useState<string[]>([]);
  const [defaultsHydrated, setDefaultsHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const res = await fetch("/api/pipeline/status");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          if (data.killSwitch) {
            setKillSwitchStatus(data.killSwitch);
          }
          if (data.defaults) {
            setServerDefaults(data.defaults);
            if (!defaultsHydrated) {
              setCitySource(data.defaults.citySource);
              if (!offerId && data.defaults.defaultOfferId) {
                setOfferId(data.defaults.defaultOfferId);
              }
              setDefaultsHydrated(true);
            }
          }
          if (Array.isArray(data.availableOffers)) {
            setAvailableOffers(
              data.availableOffers.filter((value: unknown): value is string => typeof value === "string")
            );
          }
        }
      } catch {
        // Ignore status fetch failures in the control panel.
      }
    };

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const handleLaunch = async () => {
    if (status === "running" || launching || !connected) return;

    setLaunching(true);
    try {
      const res = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forceKeywordRefresh,
          forceDesignRefresh,
          enableAgent7,
          citySource,
          offerId: offerId.trim() || undefined,
          offerZipCodes: offerZipCodes.trim() || undefined,
          ignoreIndexationKillSwitch,
          payoutPerQualifiedCall: Number.isFinite(Number(payoutPerQualifiedCall))
            ? Number(payoutPerQualifiedCall)
            : undefined,
        }),
      });
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

  const handleScan = async () => {
    if (scanning || !connected) return;

    setScanning(true);
    setScanMessage("");
    try {
      const res = await fetch("/api/agent-0.5/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: offerId.trim() || undefined,
          zipCodes: offerZipCodes.trim() || undefined,
          topN: Number.isFinite(Number(scanTopN)) ? Number(scanTopN) : undefined,
          runAgent1: scanRunAgent1,
          forceRefresh: forceKeywordRefresh,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setScanMessage(data.error ?? "Agent 0.5 scan failed");
        return;
      }

      const topCity = Array.isArray(data.candidates) && data.candidates.length > 0
        ? `${data.candidates[0].city}, ${data.candidates[0].state}`
        : "no mapped cities";
      if (data.offerId && !offerId) {
        setOfferId(data.offerId);
      }
      setScanMessage(
        `${Array.isArray(data.candidates) ? data.candidates.length : 0} candidates ready; top: ${topCity}`
      );
    } catch {
      setScanMessage("Agent 0.5 scan failed");
    } finally {
      setScanning(false);
    }
  };

  const isRunning = status === "running" || launching;
  const isDone = status === "completed";
  const isError = status === "error";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-col items-start gap-1 text-[11px] font-semibold text-kawaii-text-muted dark:text-[#9a8ab0]">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={forceKeywordRefresh}
            onChange={(event) => setForceKeywordRefresh(event.target.checked)}
            disabled={isRunning || !connected}
            className="h-3.5 w-3.5 rounded border-white/40"
          />
          <span>Force keyword refresh</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={forceDesignRefresh}
            onChange={(event) => setForceDesignRefresh(event.target.checked)}
            disabled={isRunning || !connected}
            className="h-3.5 w-3.5 rounded border-white/40"
          />
          <span>Force design refresh</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enableAgent7}
            onChange={(event) => setEnableAgent7(event.target.checked)}
            disabled={isRunning || !connected}
            className="h-3.5 w-3.5 rounded border-white/40"
          />
          <span>Enable Agent 7</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={ignoreIndexationKillSwitch}
            onChange={(event) => setIgnoreIndexationKillSwitch(event.target.checked)}
            disabled={isRunning || !connected}
            className="h-3.5 w-3.5 rounded border-white/40"
          />
          <span>Ignore indexation kill switch</span>
        </label>
        <label className="flex flex-col gap-1 w-full">
          <span>City source</span>
          <select
            value={citySource}
            onChange={(event) => setCitySource(event.target.value as "hardcoded" | "deployment_candidates")}
            disabled={isRunning || !connected}
            className="rounded-md border border-white/30 bg-white/80 px-2 py-1 text-[11px] text-slate-700"
          >
            <option value="hardcoded">Hardcoded test cities</option>
            <option value="deployment_candidates">Agent 0.5 candidates</option>
          </select>
        </label>
        {citySource === "deployment_candidates" && (
          <>
            <label className="flex flex-col gap-1 w-full">
              <span>Offer ID</span>
              <input
                type="text"
                value={offerId}
                onChange={(event) => setOfferId(event.target.value)}
                disabled={isRunning || !connected}
                placeholder="offer-123"
                list="available-offers"
                className="rounded-md border border-white/30 bg-white/80 px-2 py-1 text-[11px] text-slate-700"
              />
              <datalist id="available-offers">
                {availableOffers.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 w-full">
              <span>ZIPs (optional)</span>
              <textarea
                value={offerZipCodes}
                onChange={(event) => setOfferZipCodes(event.target.value)}
                disabled={isRunning || !connected}
                rows={3}
                placeholder="95060, 95062, 95076"
                className="rounded-md border border-white/30 bg-white/80 px-2 py-1 text-[11px] text-slate-700"
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 w-full">
          <span>Payout / qualified call</span>
          <input
            type="number"
            min="0"
            step="1"
            value={payoutPerQualifiedCall}
            onChange={(event) => setPayoutPerQualifiedCall(event.target.value)}
            disabled={isRunning || !connected}
            className="rounded-md border border-white/30 bg-white/80 px-2 py-1 text-[11px] text-slate-700"
          />
        </label>
        <div className="w-full rounded-md border border-white/25 bg-white/60 px-2 py-2 text-[10px] leading-4 text-slate-700">
          <div className="font-bold uppercase tracking-[0.08em] text-slate-500">
            Runtime Defaults
          </div>
          <div>
            City source: {serverDefaults?.citySource ?? citySource}
          </div>
          <div>
            Offer ID: {serverDefaults?.defaultOfferId ?? (offerId || "none")}
          </div>
          <div>
            Search Console: {serverDefaults?.searchConsoleEnabled ? "enabled" : "disabled"}
          </div>
        </div>
        <div className="w-full rounded-md border border-white/25 bg-white/60 px-2 py-2 text-[10px] leading-4 text-slate-700">
          <div className="font-bold uppercase tracking-[0.08em] text-slate-500">
            Kill Switch
          </div>
          <div>
            {Boolean(killSwitchStatus?.armed) && enableAgent7
              ? "Armed"
              : "Not armed"}
            {typeof killSwitchStatus?.ratio === "number"
              ? ` | ratio ${(killSwitchStatus.ratio * 100).toFixed(0)}%`
              : ""}
          </div>
          <div>
            {(!enableAgent7 && Boolean(killSwitchStatus?.configured))
              ? "Inactive while Agent 7 is off"
              : killSwitchStatus?.reason ?? "Status unavailable"}
          </div>
          {killSwitchStatus && killSwitchStatus.eligiblePages > 0 && (
            <div>
              {killSwitchStatus.indexedPages}/{killSwitchStatus.eligiblePages} eligible pages indexed
            </div>
          )}
        </div>
        {citySource === "deployment_candidates" && (
          <div className="w-full rounded-md border border-white/25 bg-white/60 px-2 py-2 text-[10px] leading-4 text-slate-700">
            <div className="font-bold uppercase tracking-[0.08em] text-slate-500">
              Agent 0.5
            </div>
            <label className="mt-1 flex flex-col gap-1 w-full">
              <span>Top candidates</span>
              <input
                type="number"
                min="1"
                step="1"
                value={scanTopN}
                onChange={(event) => setScanTopN(event.target.value)}
                disabled={isRunning || scanning || !connected}
                className="rounded-md border border-white/30 bg-white/80 px-2 py-1 text-[11px] text-slate-700"
              />
            </label>
            <label className="mt-2 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scanRunAgent1}
                onChange={(event) => setScanRunAgent1(event.target.checked)}
                disabled={isRunning || scanning || !connected}
                className="h-3.5 w-3.5 rounded border-white/40"
              />
              <span>Run Agent 1 after scan</span>
            </label>
            <button
              type="button"
              onClick={handleScan}
              disabled={isRunning || scanning || !connected}
              className={`mt-2 w-full rounded-md px-3 py-2 text-[11px] font-bold transition-colors ${
                isRunning || scanning || !connected
                  ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                  : "bg-slate-900 text-white hover:bg-slate-700"
              }`}
            >
              {scanning ? "Scanning..." : "Run Agent 0.5 Scan"}
            </button>
            {scanMessage && (
              <div className="mt-2 text-[10px] text-slate-600">
                {scanMessage}
              </div>
            )}
          </div>
        )}
      </div>
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

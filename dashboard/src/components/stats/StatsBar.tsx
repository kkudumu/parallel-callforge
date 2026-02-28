import { motion } from "framer-motion";
import { springs } from "../../lib/animations";
import { HealthGauge } from "./HealthGauge";
import type { PipelineStats, HealthScore } from "../../lib/types";
import { CheckCircle2, XCircle, Clock, FileText, AlertTriangle } from "lucide-react";

interface StatsBarProps {
  stats: PipelineStats;
  health: HealthScore;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  return (
    <div
      className="flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-4 py-1.5 sm:py-2.5 rounded-kawaii"
      style={{ backgroundColor: `${color}15` }}
    >
      <div
        className="rounded-full p-1 sm:p-1.5"
        style={{ backgroundColor: `${color}30`, color }}
      >
        {icon}
      </div>
      <div>
        <motion.div
          key={value}
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={springs.counter}
          className="font-extrabold text-base sm:text-lg leading-none text-kawaii-text dark:text-[#e0d4f0]"
        >
          {value}
        </motion.div>
        <div className="text-[9px] sm:text-[10px] text-kawaii-text-muted dark:text-[#9a8ab0] font-semibold uppercase tracking-wide">
          {label}
        </div>
      </div>
    </div>
  );
}

export function StatsBar({ stats, health }: StatsBarProps) {
  return (
    <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 gap-2 sm:gap-3">
      <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap flex-1 min-w-0">
        <StatCard
          icon={<CheckCircle2 size={12} />}
          label="Done"
          value={stats.completedTasks}
          color="#7DCEA0"
        />
        <StatCard
          icon={<Clock size={12} />}
          label="Run"
          value={stats.runningTasks}
          color="#B5D8FF"
        />
        <StatCard
          icon={<XCircle size={12} />}
          label="Fail"
          value={stats.failedTasks}
          color="#F1948A"
        />
        <StatCard
          icon={<FileText size={12} />}
          label="Pages"
          value={stats.totalPages}
          color="#E8D4FF"
        />
        <StatCard
          icon={<AlertTriangle size={12} />}
          label="Alerts"
          value={stats.totalAlerts}
          color="#F9E79F"
        />
      </div>

      <HealthGauge health={health} size={56} />
    </div>
  );
}

import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Globe, Sparkles } from "lucide-react";
import type { DeployedSite } from "../../lib/types";

interface DeployedSitesProps {
  sites: DeployedSite[];
}

export function DeployedSites({ sites }: DeployedSitesProps) {
  if (sites.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 20 }}
      className="w-full max-w-md mx-auto"
    >
      <div className="bg-white/80 dark:bg-[#241832]/80 backdrop-blur-sm rounded-kawaii-lg shadow-kawaii p-3 sm:p-4 transition-colors duration-300">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-kawaii-lavender-dark dark:text-[#c4b0e0]" />
          <h3 className="text-sm font-bold text-kawaii-text dark:text-[#e0d4f0]">
            Deployed Sites
          </h3>
        </div>

        <div className="space-y-1.5">
          <AnimatePresence>
            {sites.map((site, i) => (
              <motion.a
                key={`${site.url}-${i}`}
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1, type: "spring", stiffness: 300, damping: 20 }}
                className="
                  flex items-center gap-2 px-3 py-2
                  bg-gradient-to-r from-kawaii-mint-light to-kawaii-mint/30
                  dark:from-[#1a3025] dark:to-[#1a3025]/50
                  rounded-kawaii text-xs sm:text-sm
                  hover:shadow-kawaii-hover transition-shadow
                  group cursor-pointer
                "
              >
                <Globe size={14} className="text-emerald-500 dark:text-emerald-400 flex-shrink-0" />
                <span className="text-kawaii-text dark:text-[#e0d4f0] font-medium truncate flex-1">
                  {site.url.replace(/^https?:\/\//, "")}
                </span>
                <ExternalLink
                  size={12}
                  className="text-kawaii-text-muted dark:text-[#9a8ab0] group-hover:text-emerald-500 dark:group-hover:text-emerald-400 transition-colors flex-shrink-0"
                />
              </motion.a>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

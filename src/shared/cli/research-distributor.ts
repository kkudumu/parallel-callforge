import {
  runResearchJob,
  type ResearchJob,
  type ResearchJobResult,
  type ResearchProvider,
  type ResearchQualityThresholds,
} from "./deep-research-runner.js";

// ─── Distribution ───────────────────────────────────────────────────────────

export function distributeJobs(
  jobs: ResearchJob[],
  providers: ResearchProvider[]
): Map<ResearchProvider, ResearchJob[]> {
  const map = new Map<ResearchProvider, ResearchJob[]>();
  for (const p of providers) {
    map.set(p, []);
  }

  for (let i = 0; i < jobs.length; i++) {
    const provider = providers[i % providers.length];
    map.get(provider)!.push(jobs[i]);
  }

  return map;
}

// ─── Parallel Execution ─────────────────────────────────────────────────────

export interface DistributedResearchConfig {
  jobs: ResearchJob[];
  providers: ResearchProvider[];
  validateContent: (content: string) => boolean;
  thresholds: ResearchQualityThresholds;
  logPrefix: string;
  maxDeepeningPasses: number;
  cliPaths: { claude: string; codex: string; gemini: string };
  timeoutMs?: number;
  maxConcurrentPerProvider: number;
  estimatedTokensPerPass: number;
  maxEstimatedTokensPerJob: number;
}

async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const concurrency = Math.max(1, Math.min(maxConcurrency, tasks.length));
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      const taskIndex = nextIndex++;
      results[taskIndex] = await tasks[taskIndex]();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export async function runDistributedResearch(
  config: DistributedResearchConfig
): Promise<ResearchJobResult[]> {
  const distribution = distributeJobs(config.jobs, config.providers);

  // Log distribution plan
  for (const [provider, jobs] of distribution) {
    const filenames = jobs.map((j) => j.filename).join(", ");
    console.log(
      `${config.logPrefix} ${provider}: ${jobs.length} jobs [${filenames}]`
    );
  }

  // Run provider groups in parallel, but cap concurrency within each provider.
  const providerGroups = Array.from(distribution.entries());
  const groupedResults = await Promise.all(
    providerGroups.map(async ([provider, jobs]) => {
      const tasks = jobs.map(
        (job) => () =>
          runResearchJob(job, provider, {
            validateContent: config.validateContent,
            thresholds: config.thresholds,
            logPrefix: `${config.logPrefix}[${provider}]`,
            maxDeepeningPasses: config.maxDeepeningPasses,
            cliPaths: config.cliPaths,
            timeoutMs: config.timeoutMs,
            estimatedTokensPerPass: config.estimatedTokensPerPass,
            maxEstimatedTokensPerJob: config.maxEstimatedTokensPerJob,
          })
      );

      return runWithConcurrencyLimit(tasks, config.maxConcurrentPerProvider);
    })
  );
  const results = groupedResults.flat();

  // Log per-provider summary
  logResearchSummary(results, config.logPrefix);

  return results;
}

// ─── Metrics Summary ────────────────────────────────────────────────────────

function logResearchSummary(
  results: ResearchJobResult[],
  logPrefix: string
): void {
  const byProvider = new Map<
    ResearchProvider,
    {
      count: number;
      totalSources: number;
      totalWords: number;
      totalFindings: number;
      totalDeepeningPasses: number;
      totalDurationMs: number;
      sessionLimitCount: number;
      successCount: number;
    }
  >();

  for (const r of results) {
    const existing = byProvider.get(r.provider) ?? {
      count: 0,
      totalSources: 0,
      totalWords: 0,
      totalFindings: 0,
      totalDeepeningPasses: 0,
      totalDurationMs: 0,
      sessionLimitCount: 0,
      successCount: 0,
    };
    existing.count++;
    existing.totalSources += r.finalSourceCount;
    existing.totalWords += r.finalWordCount;
    existing.totalFindings += r.finalFindingCount;
    existing.totalDeepeningPasses += Math.max(0, r.attempts - 1);
    existing.totalDurationMs += r.durationMs;
    if (r.sessionLimitDetected) existing.sessionLimitCount++;
    if (r.success) existing.successCount++;
    byProvider.set(r.provider, existing);
  }

  console.log(`${logPrefix} [Research Summary]`);
  for (const [provider, stats] of byProvider) {
    const avgSources =
      stats.count > 0 ? Math.round(stats.totalSources / stats.count) : 0;
    const avgWords =
      stats.count > 0 ? Math.round(stats.totalWords / stats.count) : 0;
    const avgFindings =
      stats.count > 0 ? Math.round(stats.totalFindings / stats.count) : 0;
    const avgDeepening =
      stats.count > 0
        ? (stats.totalDeepeningPasses / stats.count).toFixed(1)
        : "0";
    const avgDuration =
      stats.count > 0
        ? Math.round(stats.totalDurationMs / stats.count / 1000)
        : 0;
    console.log(
      `${logPrefix}   ${provider}: ${stats.count} jobs, ` +
        `${stats.successCount}/${stats.count} passed, ` +
        `avg ${avgSources} sources, ` +
        `avg ${avgWords} words, ` +
        `avg ${avgFindings} findings, ` +
        `${avgDeepening} avg deepening passes, ` +
        `avg ${avgDuration}s, ` +
        `${stats.sessionLimitCount} session-limit events`
    );
  }
}

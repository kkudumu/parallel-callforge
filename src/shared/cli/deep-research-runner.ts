import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createCodexCli } from "./codex-cli.js";
import { createGeminiCli } from "./gemini-cli.js";
import { detectSessionLimit } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ResearchProvider = "claude" | "codex" | "gemini";

export interface ResearchJob {
  filename: string;
  topic: string;
  prompt: string;
  focus: string;
  researchDir: string;
  niche: string;
}

export interface ResearchQualityThresholds {
  minSources: number;
  minWords: number;
  minFindings: number;
}

export interface ResearchJobResult {
  job: ResearchJob;
  provider: ResearchProvider;
  success: boolean;
  sessionLimitDetected: boolean;
  attempts: number;
  finalSourceCount: number;
  finalWordCount: number;
  finalFindingCount: number;
  durationMs: number;
}

// ─── Quality Scoring ────────────────────────────────────────────────────────

interface QualityScore {
  sources: number;
  words: number;
  findings: number;
}

function getSectionContent(content: string, sectionHeader: string): string {
  const escaped = sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRegex = new RegExp(
    `^##\\s+${escaped}\\s*$\\n?([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "m"
  );
  const match = content.match(sectionRegex);
  return match?.[1] ?? "";
}

function scoreResearchContent(content: string): QualityScore {
  // Count source lines in Source Index section only.
  const sourceSection = getSectionContent(content, "Source Index");
  const sources = (sourceSection.match(/^-\s+\S+/gm) ?? []).length;

  // Count words across the full document.
  const trimmed = content.trim();
  const words = trimmed.length > 0 ? trimmed.split(/\s+/).length : 0;

  // Count finding blocks in Key Findings section only.
  const keyFindingsSection = getSectionContent(content, "Key Findings");
  const findingBlocks = keyFindingsSection.match(
    /###\s+.+\n[\s\S]*?\*\*Evidence:\*\*\s+.+\n\*\*Data:\*\*\s+.+\n\*\*Implication:\*\*\s+.+/g
  );
  const findings = findingBlocks?.length ?? 0;

  return { sources, words, findings };
}

function meetsThresholds(
  score: QualityScore,
  thresholds: ResearchQualityThresholds
): boolean {
  return (
    score.sources >= thresholds.minSources &&
    score.words >= thresholds.minWords &&
    score.findings >= thresholds.minFindings
  );
}

// ─── Deepening Prompt Builder ───────────────────────────────────────────────

function buildDeepeningPrompt(
  job: ResearchJob,
  score: QualityScore,
  thresholds: ResearchQualityThresholds
): string {
  const filePath = join(job.researchDir, job.filename);
  const gaps: string[] = [];

  if (score.sources < thresholds.minSources) {
    gaps.push(
      `- Visit at least ${thresholds.minSources - score.sources} more URLs and add them to the Source Index`
    );
  }
  if (score.findings < thresholds.minFindings) {
    gaps.push(
      `- Add at least ${thresholds.minFindings - score.findings} more finding blocks with ### title, **Evidence:**, **Data:**, **Implication:**`
    );
  }
  if (score.words < thresholds.minWords) {
    gaps.push(
      `- Expand content to reach at least ${thresholds.minWords} total words (currently ${score.words})`
    );
  }

  // Generate topic-specific additional search queries
  const topicLower = job.topic.toLowerCase();
  const additionalSearches: string[] = [];
  if (topicLower.includes("keyword")) {
    additionalSearches.push(
      `"${job.niche} long-tail search queries"`,
      `"${job.niche} autocomplete suggestions 2025"`,
      `"${job.niche} search intent classification"`
    );
  } else if (topicLower.includes("market")) {
    additionalSearches.push(
      `"${job.niche} market size by region"`,
      `"${job.niche} demand drivers demographics"`,
      `"${job.niche} industry report statistics"`
    );
  } else if (topicLower.includes("competitor")) {
    additionalSearches.push(
      `"${job.niche} top ranking websites analysis"`,
      `"${job.niche} lead generation site structure"`,
      `"${job.niche} URL slug patterns SEO"`
    );
  } else if (topicLower.includes("seo")) {
    additionalSearches.push(
      `"local SEO ranking factors ${new Date().getFullYear()}"`,
      `"service area business SEO without address"`,
      `"${job.niche} local search optimization"`
    );
  } else if (topicLower.includes("ppc") || topicLower.includes("economics")) {
    additionalSearches.push(
      `"${job.niche} cost per lead benchmarks"`,
      `"${job.niche} pay per call rates"`,
      `"${job.niche} customer lifetime value"`
    );
  } else if (topicLower.includes("gbp") || topicLower.includes("competition")) {
    additionalSearches.push(
      `"${job.niche} Google Maps competition analysis"`,
      `"${job.niche} franchise market saturation"`,
      `"${job.niche} review count competitive threshold"`
    );
  } else if (topicLower.includes("cro") || topicLower.includes("conversion")) {
    additionalSearches.push(
      `"landing page conversion rate benchmarks"`,
      `"click-to-call conversion optimization"`,
      `"A/B test results local service pages"`
    );
  } else if (topicLower.includes("design")) {
    additionalSearches.push(
      `"landing page design conversion data"`,
      `"mobile UX local service businesses"`,
      `"color psychology CTA buttons"`
    );
  } else if (topicLower.includes("copy")) {
    additionalSearches.push(
      `"headline formula conversion rate"`,
      `"CTA button text A/B test"`,
      `"direct response copywriting data"`
    );
  } else if (topicLower.includes("schema")) {
    additionalSearches.push(
      `"JSON-LD schema local business"`,
      `"structured data ${job.niche}"`,
      `"schema.org service provider markup"`
    );
  } else if (topicLower.includes("seasonal")) {
    additionalSearches.push(
      `"${job.niche} seasonal demand by month"`,
      `"${job.niche} peak season by region"`,
      `"${job.niche} marketing calendar"`
    );
  } else {
    additionalSearches.push(
      `"${job.niche} ${job.topic} research data"`,
      `"${job.niche} ${job.topic} statistics"`,
      `"${job.niche} ${job.topic} analysis"`
    );
  }

  const searchBlock = additionalSearches
    .map((q) => `  - Search for ${q}`)
    .join("\n");

  return `Your research on "${job.topic}" for ${job.niche} produced ${score.sources} sources (need ${thresholds.minSources}), ${score.words} words (need ${thresholds.minWords}), ${score.findings} findings (need ${thresholds.minFindings}).

READ the existing research file at ${filePath}, then ADD to it with additional research:

${searchBlock}

${gaps.join("\n")}

Write the COMPLETE updated file back to ${filePath}. Keep all existing content and add new findings, sources, and data to meet the quality thresholds.`;
}

// ─── Provider Dispatch ──────────────────────────────────────────────────────

async function invokeClaudeResearch(
  prompt: string,
  options: { timeoutMs: number; logPrefix: string }
): Promise<void> {
  // Use Agent SDK query() directly; each research prompt is self-contained and does
  // not require the SDK orchestrator agent wrapper.
  const query = (await import("@anthropic-ai/claude-agent-sdk")).query;

  const iterator = query({
    prompt,
    options: {
      allowedTools: ["WebSearch", "WebFetch", "Write", "Read"],
      model: "sonnet",
    },
  })[Symbol.asyncIterator]();

  const heartbeatMs = 30_000;
  const startedAt = Date.now();
  let lastEventAt = Date.now();
  let pendingNext = iterator.next();

  while (true) {
    const raced = await nextOrTick(pendingNext, heartbeatMs);

    if (raced.type === "tick") {
      const now = Date.now();
      const elapsedMs = now - startedAt;
      const idleMs = now - lastEventAt;

      if (elapsedMs > options.timeoutMs) {
        if (typeof iterator.return === "function") {
          await iterator.return();
        }
        throw new Error(
          `${options.logPrefix} Claude research timed out after ${Math.round(elapsedMs / 1000)}s`
        );
      }
      if (idleMs > options.timeoutMs) {
        if (typeof iterator.return === "function") {
          await iterator.return();
        }
        throw new Error(
          `${options.logPrefix} Claude research stalled after ${Math.round(idleMs / 1000)}s idle`
        );
      }

      console.log(
        `${options.logPrefix} Still running... ${Math.round(elapsedMs / 1000)}s elapsed, ` +
          `${Math.round(idleMs / 1000)}s since last event`
      );
      continue;
    }

    const { done } = raced.result;
    if (done) break;
    lastEventAt = Date.now();
    pendingNext = iterator.next();
  }
}

async function invokeCodexResearch(
  codexPath: string,
  prompt: string,
  options: { timeoutMs: number; logPrefix: string }
): Promise<void> {
  const codex = createCodexCli(codexPath);
  await codex.invoke({
    prompt,
    timeoutMs: options.timeoutMs,
  });
}

async function invokeGeminiResearch(
  geminiPath: string,
  prompt: string,
  options: { timeoutMs: number; logPrefix: string }
): Promise<void> {
  const gemini = createGeminiCli(geminiPath);
  await gemini.invoke({
    prompt,
    timeoutMs: options.timeoutMs,
  });
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function nextOrTick<T>(
  pending: Promise<T>,
  ms: number
): Promise<{ type: "message"; result: T } | { type: "tick" }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ type: "tick" }), ms);
    pending
      .then((result) => {
        clearTimeout(timer);
        resolve({ type: "message", result });
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ─── Main Runner ────────────────────────────────────────────────────────────

export async function runResearchJob(
  job: ResearchJob,
  provider: ResearchProvider,
  options: {
    validateContent: (content: string) => boolean;
    thresholds: ResearchQualityThresholds;
    logPrefix: string;
    maxDeepeningPasses: number;
    cliPaths: { claude: string; codex: string; gemini: string };
    timeoutMs?: number;
    estimatedTokensPerPass: number;
    maxEstimatedTokensPerJob: number;
  }
): Promise<ResearchJobResult> {
  const startedAt = Date.now();
  const perPassTimeout = options.timeoutMs ?? 12 * 60_000;
  const filePath = join(job.researchDir, job.filename);
  let attempts = 0;
  let estimatedTokensSpent = 0;
  let sessionLimitDetected = false;

  const invoke = async (prompt: string) => {
    estimatedTokensSpent += options.estimatedTokensPerPass;
    switch (provider) {
      case "claude":
        await invokeClaudeResearch(prompt, {
          timeoutMs: perPassTimeout,
          logPrefix: options.logPrefix,
        });
        break;
      case "codex":
        await invokeCodexResearch(options.cliPaths.codex, prompt, {
          timeoutMs: perPassTimeout,
          logPrefix: options.logPrefix,
        });
        break;
      case "gemini":
        await invokeGeminiResearch(options.cliPaths.gemini, prompt, {
          timeoutMs: perPassTimeout,
          logPrefix: options.logPrefix,
        });
        break;
    }
  };

  // Initial research pass
  attempts = 1;
  console.log(
    `${options.logPrefix} Starting ${job.filename} on ${provider} (pass 1)`
  );
  try {
    await invoke(job.prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sessionLimitDetected ||= detectSessionLimit(msg);
    console.warn(
      `${options.logPrefix} Initial pass failed for ${job.filename}: ${msg.split("\n")[0]}`
    );
    if (detectSessionLimit(msg)) {
      console.warn(
        `${options.logPrefix} Session limit detected on ${provider}; continuing same-provider retries`
      );
    }
  }

  // Iterative deepening loop
  for (let pass = 2; pass <= options.maxDeepeningPasses + 1; pass++) {
    if (!existsSync(filePath)) {
      console.warn(
        `${options.logPrefix} ${job.filename} not found after pass ${pass - 1}, retrying initial prompt`
      );
      attempts++;
      try {
        await invoke(job.prompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sessionLimitDetected ||= detectSessionLimit(msg);
        console.warn(
          `${options.logPrefix} Retry pass failed for ${job.filename}: ${msg.split("\n")[0]}`
        );
        if (detectSessionLimit(msg)) {
          console.warn(
            `${options.logPrefix} Session limit detected on ${provider}; continuing same-provider retries`
          );
        }
      }
      continue;
    }

    const content = readFileSync(filePath, "utf8");

    // Check basic validation first
    if (!options.validateContent(content)) {
      console.warn(
        `${options.logPrefix} ${job.filename} failed basic validation after pass ${pass - 1}`
      );
      // Don't count as a deepening pass if basic validation fails — retry
      if (pass <= options.maxDeepeningPasses + 1) {
        attempts++;
        try {
          await invoke(job.prompt);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sessionLimitDetected ||= detectSessionLimit(msg);
          console.warn(
            `${options.logPrefix} Validation retry failed: ${msg.split("\n")[0]}`
          );
          if (detectSessionLimit(msg)) {
            console.warn(
              `${options.logPrefix} Session limit detected on ${provider}; continuing same-provider retries`
            );
          }
        }
        continue;
      }
    }

    const score = scoreResearchContent(content);

    if (meetsThresholds(score, options.thresholds)) {
      const durationMs = Date.now() - startedAt;
      console.log(
        `${options.logPrefix} ${job.filename} meets thresholds after ${attempts} pass(es): ` +
          `sources=${score.sources} words=${score.words} findings=${score.findings} ` +
          `duration=${Math.round(durationMs / 1000)}s est_tokens=${estimatedTokensSpent}`
      );
      return {
        job,
        provider,
        success: true,
        sessionLimitDetected,
        attempts,
        finalSourceCount: score.sources,
        finalWordCount: score.words,
        finalFindingCount: score.findings,
        durationMs,
      };
    }

    if (pass > options.maxDeepeningPasses + 1) break;

    const projectedTokens = estimatedTokensSpent + options.estimatedTokensPerPass;
    if (projectedTokens > options.maxEstimatedTokensPerJob) {
      console.warn(
        `${options.logPrefix} ${job.filename} stopping deepening at pass ${pass} due to token guardrail: ` +
          `projected=${projectedTokens} max=${options.maxEstimatedTokensPerJob}`
      );
      break;
    }

    // Build and run deepening prompt
    const deepeningPrompt = buildDeepeningPrompt(
      job,
      score,
      options.thresholds
    );
    console.log(
      `${options.logPrefix} ${job.filename} needs deepening (pass ${pass}): ` +
        `sources=${score.sources}/${options.thresholds.minSources} ` +
        `words=${score.words}/${options.thresholds.minWords} ` +
        `findings=${score.findings}/${options.thresholds.minFindings}`
    );
    attempts++;
    try {
      await invoke(deepeningPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionLimitDetected ||= detectSessionLimit(msg);
      console.warn(
        `${options.logPrefix} Deepening pass ${pass} failed: ${msg.split("\n")[0]}`
      );
      if (detectSessionLimit(msg)) {
        console.warn(
          `${options.logPrefix} Session limit detected on ${provider}; continuing same-provider retries`
        );
      }
    }
  }

  // Final scoring
  let finalScore: QualityScore = { sources: 0, words: 0, findings: 0 };
  let success = false;
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, "utf8");
    finalScore = scoreResearchContent(content);
    success =
      options.validateContent(content) &&
      meetsThresholds(finalScore, options.thresholds);
  }

  const status = success ? "passed" : "partial";
  const durationMs = Date.now() - startedAt;
  console.log(
    `${options.logPrefix} ${job.filename} ${status} after ${attempts} pass(es): ` +
      `sources=${finalScore.sources} words=${finalScore.words} findings=${finalScore.findings} ` +
      `duration=${Math.round(durationMs / 1000)}s est_tokens=${estimatedTokensSpent}`
  );

  return {
    job,
    provider,
    success,
    sessionLimitDetected,
    attempts,
    finalSourceCount: finalScore.sources,
    finalWordCount: finalScore.words,
    finalFindingCount: finalScore.findings,
    durationMs,
  };
}

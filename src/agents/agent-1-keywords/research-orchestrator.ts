import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getEnv } from "../../config/env.js";
import { runDistributedResearch } from "../../shared/cli/research-distributor.js";
import type {
  ResearchProvider,
  ResearchQualityThresholds,
} from "../../shared/cli/deep-research-runner.js";
import {
  buildKeywordPatternResearcherPrompt,
  buildMarketDataResearcherPrompt,
  buildCompetitorKeywordResearcherPrompt,
  buildLocalSeoResearcherPrompt,
  buildPpcEconomicsResearcherPrompt,
  buildGbpCompetitionResearcherPrompt,
} from "./subagent-prompts.js";
import {
  readResearchFile,
  validateResearchFile,
} from "./research-reader.js";

const DEFAULT_MIN_VALID_FILES = 4;

export interface ResearchFindings {
  keywordPatterns: string | null;
  marketData: string | null;
  competitorKeywords: string | null;
  localSeo: string | null;
  ppcEconomics: string | null;
  gbpCompetition: string | null;
}

export interface ResearchPhaseConfig {
  niche: string;
  researchDir: string;
  minValidFiles?: number;
  stallTimeoutMs?: number;
  maxDurationMs?: number;
  heartbeatMs?: number;
}

function parseProviderSplit(split: string): ResearchProvider[] {
  return split
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ResearchProvider =>
      s === "claude" || s === "codex" || s === "gemini"
    );
}

export async function runResearchPhase(
  cfg: ResearchPhaseConfig
): Promise<ResearchFindings> {
  mkdirSync(cfg.researchDir, { recursive: true });
  console.log(`[Agent 1][Research] Starting research phase for "${cfg.niche}"`);
  console.log(`[Agent 1][Research] Research dir: ${cfg.researchDir}`);

  const env = getEnv();
  const providers = parseProviderSplit(env.RESEARCH_PROVIDER_SPLIT);
  if (providers.length === 0) {
    throw new Error(
      "[Agent 1][Research] No valid providers in RESEARCH_PROVIDER_SPLIT"
    );
  }

  const thresholds: ResearchQualityThresholds = {
    minSources: env.RESEARCH_MIN_SOURCES,
    minWords: env.RESEARCH_MIN_WORDS,
    minFindings: env.RESEARCH_MIN_FINDINGS,
  };

  const promptCfg = { niche: cfg.niche, researchDir: cfg.researchDir };

  const jobs = [
    {
      filename: "keyword-patterns.md",
      topic: "Keyword Pattern",
      prompt: buildKeywordPatternResearcherPrompt(promptCfg),
      focus: "SERP intent patterns, autocomplete clusters, emergency modifiers",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "market-data.md",
      topic: "Market Data",
      prompt: buildMarketDataResearcherPrompt(promptCfg),
      focus: "regional demand, climate/pest pressure drivers, demographics",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "competitor-keywords.md",
      topic: "Competitor Keyword",
      prompt: buildCompetitorKeywordResearcherPrompt(promptCfg),
      focus: "URL slug patterns, title/meta keyword structures",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "local-seo.md",
      topic: "Local SEO",
      prompt: buildLocalSeoResearcherPrompt(promptCfg),
      focus: "ranking signals for service-area businesses without GBP",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "ppc-economics.md",
      topic: "PPC Economics",
      prompt: buildPpcEconomicsResearcherPrompt(promptCfg),
      focus: "CPC/CPL/pay-per-call economics, lead value bands",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "gbp-competition.md",
      topic: "GBP Competition",
      prompt: buildGbpCompetitionResearcherPrompt(promptCfg),
      focus: "Map Pack density, review distributions, franchise saturation",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
  ];

  console.log(
    `[Agent 1][Research] Distributing ${jobs.length} jobs across [${providers.join(", ")}]`
  );

  const results = await runDistributedResearch({
    jobs,
    providers,
    validateContent: validateResearchFile,
    thresholds,
    logPrefix: "[Agent 1][Research]",
    maxDeepeningPasses: env.RESEARCH_MAX_DEEPENING_PASSES,
    maxConcurrentPerProvider: env.RESEARCH_PROVIDER_MAX_CONCURRENCY,
    estimatedTokensPerPass: env.RESEARCH_EST_TOKENS_PER_PASS,
    maxEstimatedTokensPerJob: env.RESEARCH_MAX_EST_TOKENS_PER_JOB,
    cliPaths: {
      claude: env.CLAUDE_CLI_PATH,
      codex: env.CODEX_CLI_PATH,
      gemini: env.GEMINI_CLI_PATH,
    },
  });

  const successCount = results.filter((r) => r.success).length;
  console.log(
    `[Agent 1][Research] Distribution complete: ${successCount}/${results.length} jobs met thresholds`
  );

  const findings = readResearchFindings(cfg.researchDir);
  const validCount = Object.values(findings).filter(Boolean).length;
  const threshold = Math.max(
    1,
    Math.min(6, cfg.minValidFiles ?? DEFAULT_MIN_VALID_FILES)
  );
  if (validCount < threshold) {
    throw new Error(
      `[Agent 1][Research] Research phase produced only ${validCount}/6 valid files (minimum required: ${threshold})`
    );
  }

  return findings;
}

function readResearchFindings(researchDir: string): ResearchFindings {
  const read = (filename: string): string | null => {
    const path = join(researchDir, filename);
    const content = readResearchFile(path);
    if (!content) {
      console.warn(
        `[Agent 1][Research] Warning: ${filename} not found after research`
      );
      return null;
    }
    if (!validateResearchFile(content)) {
      console.warn(
        `[Agent 1][Research] Warning: ${filename} failed validation (too short or missing required sections)`
      );
      return null;
    }
    const wordCount = content.split(/\s+/).length;
    console.log(`[Agent 1][Research] Loaded ${filename} (${wordCount} words)`);
    return content;
  };

  return {
    keywordPatterns: read("keyword-patterns.md"),
    marketData: read("market-data.md"),
    competitorKeywords: read("competitor-keywords.md"),
    localSeo: read("local-seo.md"),
    ppcEconomics: read("ppc-economics.md"),
    gbpCompetition: read("gbp-competition.md"),
  };
}

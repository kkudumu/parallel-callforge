import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getEnv } from "../../config/env.js";
import { runDistributedResearch } from "../../shared/cli/research-distributor.js";
import type {
  ResearchProvider,
  ResearchQualityThresholds,
} from "../../shared/cli/deep-research-runner.js";
import {
  buildCompetitorAnalystPrompt,
  buildCroResearcherPrompt,
  buildDesignResearcherPrompt,
  buildCopyResearcherPrompt,
  buildSchemaResearcherPrompt,
  buildSeasonalResearcherPrompt,
} from "./subagent-prompts.js";
import { readResearchFile, validateResearchFile } from "./research-reader.js";

export const RESEARCH_FILE_NAMES = [
  "competitors.md",
  "cro-data.md",
  "design.md",
  "copy.md",
  "schema.md",
  "seasonal.md",
] as const;

export interface ResearchFindings {
  competitors: string | null;
  croData: string | null;
  design: string | null;
  copy: string | null;
  schema: string | null;
  seasonal: string | null;
}

export interface ResearchPhaseConfig {
  niche: string;
  researchDir: string;
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
  console.log(`[Agent 2][Research] Starting research phase for "${cfg.niche}"`);
  console.log(`[Agent 2][Research] Research dir: ${cfg.researchDir}`);

  const env = getEnv();
  const providers = parseProviderSplit(env.RESEARCH_PROVIDER_SPLIT);
  if (providers.length === 0) {
    throw new Error(
      "[Agent 2][Research] No valid providers in RESEARCH_PROVIDER_SPLIT"
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
      filename: "competitors.md",
      topic: "Competitor",
      prompt: buildCompetitorAnalystPrompt(promptCfg),
      focus: "CTA patterns, layout order, trust signals, mobile behavior",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "cro-data.md",
      topic: "CRO Data",
      prompt: buildCroResearcherPrompt(promptCfg),
      focus: "A/B test results, conversion lift patterns, call CTA performance",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "design.md",
      topic: "Design",
      prompt: buildDesignResearcherPrompt(promptCfg),
      focus: "color/typography/layout decisions tied to conversion impact",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "copy.md",
      topic: "Copy",
      prompt: buildCopyResearcherPrompt(promptCfg),
      focus: "headline formulas, CTA wording tests, reading-level effects",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "schema.md",
      topic: "Schema",
      prompt: buildSchemaResearcherPrompt(promptCfg),
      focus: "JSON-LD for local service sites, valid schema combinations",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
    {
      filename: "seasonal.md",
      topic: "Seasonal",
      prompt: buildSeasonalResearcherPrompt(promptCfg),
      focus: "monthly/regional demand patterns, budget timing, seasonality",
      researchDir: cfg.researchDir,
      niche: cfg.niche,
    },
  ];

  console.log(
    `[Agent 2][Research] Distributing ${jobs.length} jobs across [${providers.join(", ")}]`
  );

  const results = await runDistributedResearch({
    jobs,
    providers,
    validateContent: validateResearchFile,
    thresholds,
    logPrefix: "[Agent 2][Research]",
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
    `[Agent 2][Research] Distribution complete: ${successCount}/${results.length} jobs met thresholds`
  );

  return readResearchFindings(cfg.researchDir);
}

function readResearchFindings(researchDir: string): ResearchFindings {
  const read = (filename: string): string | null => {
    const path = join(researchDir, filename);
    const content = readResearchFile(path);
    if (!content) {
      console.warn(
        `[Agent 2][Research] Warning: ${filename} not found after research`
      );
      return null;
    }
    if (!validateResearchFile(content)) {
      console.warn(
        `[Agent 2][Research] Warning: ${filename} failed validation (too short or missing Source Index)`
      );
      return null;
    }
    console.log(
      `[Agent 2][Research] Loaded ${filename} (${content.split(/\s+/).length} words)`
    );
    return content;
  };

  return {
    competitors: read("competitors.md"),
    croData: read("cro-data.md"),
    design: read("design.md"),
    copy: read("copy.md"),
    schema: read("schema.md"),
    seasonal: read("seasonal.md"),
  };
}

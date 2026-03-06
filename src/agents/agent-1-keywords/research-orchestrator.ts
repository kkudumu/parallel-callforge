import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
}

async function loadAgentSdkQuery() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  return sdk.query;
}

export async function runResearchPhase(
  cfg: ResearchPhaseConfig
): Promise<ResearchFindings> {
  mkdirSync(cfg.researchDir, { recursive: true });
  console.log(`[Agent 1][Research] Starting research phase for "${cfg.niche}"`);
  console.log(`[Agent 1][Research] Research dir: ${cfg.researchDir}`);

  const orchestratorPrompt = buildOrchestratorPrompt(cfg);
  const query = await loadAgentSdkQuery();

  for await (const message of query({
    prompt: orchestratorPrompt,
    options: {
      allowedTools: ["Task", "Write", "Read", "WebSearch", "WebFetch"],
      agents: {
        "keyword-pattern-researcher": {
          description: "Finds real keyword patterns pest control customers search for — SERP analysis, autocomplete, intent classification. Use for keyword template research.",
          prompt: buildKeywordPatternResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "market-data-researcher": {
          description: "Finds US regional pest control market data — NOAA climate, HUD TIP zones, NPMA reports, demographic signals. Use for market sizing and climate scoring data.",
          prompt: buildMarketDataResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "competitor-keyword-researcher": {
          description: "Analyzes URL slug patterns and keyword structures of top-ranking rank-and-rent pest control sites. Use for competitor keyword structure research.",
          prompt: buildCompetitorKeywordResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "local-seo-researcher": {
          description: "Finds local SEO ranking factors for service businesses without a GBP — rank-and-rent model specifics. Use for local SEO factor data.",
          prompt: buildLocalSeoResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "ppc-economics-researcher": {
          description: "Finds pay-per-call rates, CPL benchmarks, and lead value data for pest control markets. Use for monetization economics research.",
          prompt: buildPpcEconomicsResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "gbp-competition-researcher": {
          description: "Analyzes GBP density, Map Pack saturation, franchise presence, and review distribution in pest control markets. Use for competition scoring threshold data.",
          prompt: buildGbpCompetitionResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
      },
    },
  })) {
    const msg = message as any;

    for (const block of msg.message?.content ?? []) {
      if (block.type === "tool_use" && block.name === "Task") {
        console.log(`[Agent 1][Research] Spawning subagent: ${block.input?.subagent_type ?? "unknown"}`);
      }
    }

    if ("is_error" in msg && msg.is_error) {
      throw new Error(`[Agent 1][Research] Research phase failed: ${msg.result}`);
    }

    if ("result" in msg) {
      console.log("[Agent 1][Research] Orchestrator complete");
    }
  }

  const findings = readResearchFindings(cfg.researchDir);
  const validCount = Object.values(findings).filter(Boolean).length;
  const threshold = Math.max(1, Math.min(6, cfg.minValidFiles ?? DEFAULT_MIN_VALID_FILES));
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
      console.warn(`[Agent 1][Research] Warning: ${filename} not found after research`);
      return null;
    }
    if (!validateResearchFile(content)) {
      console.warn(`[Agent 1][Research] Warning: ${filename} failed validation (too short or missing required sections)`);
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

function buildOrchestratorPrompt(cfg: ResearchPhaseConfig): string {
  return `You are the lead market research orchestrator for a ${cfg.niche} keyword research and market selection system.

Your job: spawn all 6 research subagents IN PARALLEL using the Task tool simultaneously. Do not run them sequentially — call all 6 Task tools in the same response.

Research directory: ${cfg.researchDir}

The 6 subagents and what they do:
- keyword-pattern-researcher: finds real keyword patterns pest control customers search for
- market-data-researcher: finds US regional pest pressure and demographic data
- competitor-keyword-researcher: analyzes URL structures of top-ranking pest control lead-gen sites
- local-seo-researcher: finds ranking factors for sites without a Google Business Profile
- ppc-economics-researcher: finds pay-per-call rates and lead value benchmarks
- gbp-competition-researcher: finds GBP density and competition saturation thresholds

CRITICAL: Invoke all 6 simultaneously. Each will write its findings to a .md file in ${cfg.researchDir}.

Once all 6 complete, use the Read tool to verify each file exists and has content. If any file is missing or thin (under 300 words), note it but do not re-spawn — the calling code handles partial results.

Start wide: instruct each subagent to search broadly before drilling into specifics. Real data only — no synthesized summaries from training data. Quality over speed.`;
}

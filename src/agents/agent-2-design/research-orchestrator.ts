import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
}

export async function runResearchPhase(
  cfg: ResearchPhaseConfig
): Promise<ResearchFindings> {
  mkdirSync(cfg.researchDir, { recursive: true });
  console.log(`[Agent 2][Research] Starting research phase for "${cfg.niche}"`);
  console.log(`[Agent 2][Research] Research dir: ${cfg.researchDir}`);

  const orchestratorPrompt = buildOrchestratorPrompt(cfg);

  for await (const message of query({
    prompt: orchestratorPrompt,
    options: {
      allowedTools: ["Task", "Write", "Read", "WebSearch", "WebFetch"],
      agents: {
        "competitor-analyzer": {
          description: "Visits real pest control websites across US markets and extracts CTA patterns, layout order, trust signals, and mobile behavior. Use for competitor research.",
          prompt: buildCompetitorAnalystPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "cro-researcher": {
          description: "Finds CRO case studies, A/B test results, and conversion benchmarks for local service landing pages. Use for conversion rate data.",
          prompt: buildCroResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "design-researcher": {
          description: "Researches visual design data — colors, typography, layout, mobile UX, page speed impact on conversions. Use for design specifications.",
          prompt: buildDesignResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "copy-researcher": {
          description: "Finds copywriting performance data — headline formulas, CTA text tests, reading level research, PAS scripts. Use for copy framework.",
          prompt: buildCopyResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "schema-researcher": {
          description: "Researches JSON-LD schema markup for local service businesses without a Google Business Profile. Use for schema templates.",
          prompt: buildSchemaResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
        "seasonal-researcher": {
          description: "Finds real pest activity data by month and region, and marketing spend benchmarks. Use for seasonal calendar.",
          prompt: buildSeasonalResearcherPrompt(cfg),
          tools: ["WebSearch", "WebFetch", "Write"],
          model: "sonnet",
        },
      },
    },
  })) {
    const msg = message as any;

    // Log subagent invocations
    for (const block of msg.message?.content ?? []) {
      if (block.type === "tool_use" && block.name === "Task") {
        console.log(`[Agent 2][Research] Spawning subagent: ${block.input?.subagent_type ?? "unknown"}`);
      }
    }

    // Check for error
    if ("is_error" in msg && msg.is_error) {
      throw new Error(`Research phase failed: ${msg.result}`);
    }

    if ("result" in msg) {
      console.log(`[Agent 2][Research] Orchestrator complete`);
    }
  }

  return readResearchFindings(cfg.researchDir);
}

function readResearchFindings(researchDir: string): ResearchFindings {
  const read = (filename: string): string | null => {
    const path = join(researchDir, filename);
    const content = readResearchFile(path);
    if (!content) {
      console.warn(`[Agent 2][Research] Warning: ${filename} not found after research`);
      return null;
    }
    if (!validateResearchFile(content)) {
      console.warn(`[Agent 2][Research] Warning: ${filename} failed validation (too short or missing Source Index)`);
      return null;
    }
    console.log(`[Agent 2][Research] Loaded ${filename} (${content.split(/\s+/).length} words)`);
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

function buildOrchestratorPrompt(cfg: ResearchPhaseConfig): string {
  return `You are the lead research orchestrator for a ${cfg.niche} landing page design system.

Your job: spawn all 6 research subagents IN PARALLEL using the Task tool simultaneously. Do not run them sequentially — call all 6 Task tools in the same response.

Research directory: ${cfg.researchDir}

The 6 subagents and what they do:
- competitor-analyzer: visits real ${cfg.niche} websites, extracts CTA and layout patterns
- cro-researcher: finds A/B test data and conversion benchmarks for local services
- design-researcher: researches color, typography, mobile UX conversion data
- copy-researcher: finds headline formula and CTA copy performance data
- schema-researcher: researches JSON-LD schema for local service businesses
- seasonal-researcher: finds pest activity data and marketing calendar benchmarks

CRITICAL: Invoke all 6 simultaneously. Each will write its findings to a .md file in ${cfg.researchDir}.

Once all 6 complete, use the Read tool to verify each file exists and has content. If any file is missing or appears thin (under 500 words), note it in your response but do not re-spawn — the calling code will handle it.

Start wide: instruct each subagent to begin with broad search terms before drilling into specifics. Quality over speed — we want real data, not the first results found.`;
}

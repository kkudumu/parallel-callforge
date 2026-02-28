import { z } from "zod/v4";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { DesignSpecSchema } from "../../shared/schemas/design-specs.js";
import { CopyFrameworkSchema } from "../../shared/schemas/copy-frameworks.js";
import {
  COMPETITOR_ANALYSIS_PROMPT,
  DESIGN_SPEC_PROMPT,
  COPY_FRAMEWORK_PROMPT,
  SCHEMA_TEMPLATE_PROMPT,
  SEASONAL_CALENDAR_PROMPT,
} from "./prompts.js";

// Internal schema for competitor analysis (not persisted to DB as its own table)
const CompetitorAnalysisSchema = z.object({
  patterns: z.array(z.object({
    category: z.string(),
    findings: z.array(z.string()),
    recommendation: z.string(),
  })),
  top_cta_patterns: z.array(z.string()),
  trust_signal_types: z.array(z.string()),
  layout_order: z.array(z.string()),
});

const SchemaTemplateSchema = z.object({
  niche: z.string(),
  jsonld_templates: z.record(z.string(), z.any()),
});

const SeasonalCalendarSchema = z.object({
  niche: z.string(),
  months: z.array(z.object({
    month: z.number().min(1).max(12),
    name: z.string(),
    primary_pests: z.array(z.string()),
    content_topics: z.array(z.string()),
    messaging_priority: z.string(),
    seasonal_keywords: z.array(z.string()),
  })),
});

export interface Agent2Config {
  niche: string;
}

export async function runAgent2(
  config: Agent2Config,
  llm: LlmClient,
  db: DbClient
): Promise<void> {
  console.log(`[Agent 2] Starting design research for ${config.niche}`);

  // Check if design spec already exists for this niche
  const existing = await db.query(
    "SELECT id FROM design_specs WHERE niche = $1",
    [config.niche]
  );
  if (existing.rows.length > 0) {
    console.log(`[Agent 2] Design spec already exists for ${config.niche}, skipping`);
    return;
  }

  // Step 1: Competitor analysis
  console.log("[Agent 2] Step 1: Running competitor analysis...");
  const competitorPrompt = COMPETITOR_ANALYSIS_PROMPT.replace("{niche}", config.niche);
  const competitorAnalysis = await llm.call({
    prompt: competitorPrompt,
    schema: CompetitorAnalysisSchema,
  });
  console.log(`[Agent 2] Found ${competitorAnalysis.patterns.length} CRO patterns`);

  // Step 2: Design specification
  console.log("[Agent 2] Step 2: Generating design specification...");
  const designPrompt = DESIGN_SPEC_PROMPT
    .replace("{niche}", config.niche)
    .replace("{competitor_analysis}", JSON.stringify(competitorAnalysis, null, 2));
  const designSpec = await llm.call({
    prompt: designPrompt,
    schema: DesignSpecSchema,
  });

  await db.query(
    `INSERT INTO design_specs (niche, archetype, layout, components, colors, typography, responsive_breakpoints)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      designSpec.niche,
      designSpec.archetype,
      JSON.stringify(designSpec.layout),
      JSON.stringify(designSpec.components),
      JSON.stringify(designSpec.colors),
      JSON.stringify(designSpec.typography),
      JSON.stringify(designSpec.responsive_breakpoints),
    ]
  );
  console.log("[Agent 2] Saved design spec");

  // Step 3: Copy framework
  console.log("[Agent 2] Step 3: Generating copy framework...");
  const copyPrompt = COPY_FRAMEWORK_PROMPT.replace("{niche}", config.niche);
  const copyFramework = await llm.call({
    prompt: copyPrompt,
    schema: CopyFrameworkSchema,
  });

  await db.query(
    `INSERT INTO copy_frameworks (niche, headlines, ctas, trust_signals, faq_templates, pas_scripts)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      copyFramework.niche,
      JSON.stringify(copyFramework.headlines),
      JSON.stringify(copyFramework.ctas),
      JSON.stringify(copyFramework.trust_signals),
      JSON.stringify(copyFramework.faq_templates),
      JSON.stringify(copyFramework.pas_scripts),
    ]
  );
  console.log("[Agent 2] Saved copy framework");

  // Step 4: Schema templates (JSON-LD)
  console.log("[Agent 2] Step 4: Generating schema templates...");
  const schemaPrompt = SCHEMA_TEMPLATE_PROMPT.replace("{niche}", config.niche);
  const schemaTemplates = await llm.call({
    prompt: schemaPrompt,
    schema: SchemaTemplateSchema,
  });

  await db.query(
    `INSERT INTO schema_templates (niche, jsonld_templates) VALUES ($1, $2)`,
    [schemaTemplates.niche, JSON.stringify(schemaTemplates.jsonld_templates)]
  );
  console.log("[Agent 2] Saved schema templates");

  // Step 5: Seasonal calendar
  console.log("[Agent 2] Step 5: Generating seasonal calendar...");
  const seasonalPrompt = SEASONAL_CALENDAR_PROMPT.replace("{niche}", config.niche);
  const seasonalCalendar = await llm.call({
    prompt: seasonalPrompt,
    schema: SeasonalCalendarSchema,
  });

  await db.query(
    `INSERT INTO seasonal_calendars (niche, months) VALUES ($1, $2)`,
    [seasonalCalendar.niche, JSON.stringify(seasonalCalendar.months)]
  );
  console.log("[Agent 2] Saved seasonal calendar");

  console.log("[Agent 2] Design research complete");
}

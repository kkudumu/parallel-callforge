import { z } from "zod/v4";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { DesignSpecSchema } from "../../shared/schemas/design-specs.js";
import { CopyFrameworkSchema } from "../../shared/schemas/copy-frameworks.js";
import { eventBus } from "../../shared/events/event-bus.js";
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
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Starting", detail: config.niche, timestamp: Date.now() });

  console.log(`[Agent 2] Refreshing design research for ${config.niche}`);

  // Step 1: Competitor analysis
  console.log("[Agent 2] Step 1: Running competitor analysis...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Competitor analysis", detail: "CRO patterns", timestamp: Date.now() });
  const competitorPrompt = COMPETITOR_ANALYSIS_PROMPT.replace("{niche}", config.niche);
  const competitorAnalysis = await llm.call({
    prompt: competitorPrompt,
    schema: CompetitorAnalysisSchema,
  });
  console.log(`[Agent 2] Found ${competitorAnalysis.patterns.length} CRO patterns`);
  console.log(
    `[Agent 2] Pattern categories: ${competitorAnalysis.patterns
      .slice(0, 5)
      .map((pattern) => pattern.category)
      .join(" | ")}`
  );
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Patterns found", detail: `${competitorAnalysis.patterns.length} CRO patterns`, timestamp: Date.now() });

  // Step 2: Design specification
  console.log("[Agent 2] Step 2: Generating design specification...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Design spec", detail: "Generating specification", timestamp: Date.now() });
  const designPrompt = DESIGN_SPEC_PROMPT
    .replace("{niche}", config.niche)
    .replace("{competitor_analysis}", JSON.stringify(competitorAnalysis, null, 2));
  const designSpec = await llm.call({
    prompt: designPrompt,
    schema: DesignSpecSchema,
  });
  console.log(`[Agent 2] Design archetype: ${designSpec.archetype}`);
  console.log(
    `[Agent 2] Layout sections: ${Object.keys(designSpec.layout).slice(0, 6).join(" | ")}`
  );

  await db.query(
    `INSERT INTO design_specs (niche, archetype, layout, components, colors, typography, responsive_breakpoints)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (niche) DO UPDATE SET
       archetype = EXCLUDED.archetype,
       layout = EXCLUDED.layout,
       components = EXCLUDED.components,
       colors = EXCLUDED.colors,
       typography = EXCLUDED.typography,
       responsive_breakpoints = EXCLUDED.responsive_breakpoints,
       updated_at = now()`,
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
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Spec saved", detail: "Design specification stored", timestamp: Date.now() });

  // Step 3: Copy framework
  console.log("[Agent 2] Step 3: Generating copy framework...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Copy framework", detail: "Headlines, CTAs, trust signals", timestamp: Date.now() });
  const copyPrompt = COPY_FRAMEWORK_PROMPT.replace("{niche}", config.niche);
  const copyFramework = await llm.call({
    prompt: copyPrompt,
    schema: CopyFrameworkSchema,
  });
  console.log(
    `[Agent 2] Headline directions: ${copyFramework.headlines.slice(0, 4).join(" | ")}`
  );
  console.log(`[Agent 2] CTA variants: ${copyFramework.ctas.slice(0, 4).join(" | ")}`);

  await db.query(
    `INSERT INTO copy_frameworks (niche, headlines, ctas, trust_signals, faq_templates, pas_scripts)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (niche) DO UPDATE SET
       headlines = EXCLUDED.headlines,
       ctas = EXCLUDED.ctas,
       trust_signals = EXCLUDED.trust_signals,
       faq_templates = EXCLUDED.faq_templates,
       pas_scripts = EXCLUDED.pas_scripts,
       updated_at = now()`,
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
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Copy saved", detail: "Copy framework stored", timestamp: Date.now() });

  // Step 4: Schema templates (JSON-LD)
  console.log("[Agent 2] Step 4: Generating schema templates...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Schema templates", detail: "JSON-LD generation", timestamp: Date.now() });
  const schemaPrompt = SCHEMA_TEMPLATE_PROMPT.replace("{niche}", config.niche);
  const schemaTemplates = await llm.call({
    prompt: schemaPrompt,
    schema: SchemaTemplateSchema,
  });
  console.log(
    `[Agent 2] Schema template types: ${Object.keys(schemaTemplates.jsonld_templates)
      .slice(0, 6)
      .join(" | ")}`
  );

  await db.query(
    `INSERT INTO schema_templates (niche, jsonld_templates)
     VALUES ($1, $2)
     ON CONFLICT (niche) DO UPDATE SET
       jsonld_templates = EXCLUDED.jsonld_templates`,
    [schemaTemplates.niche, JSON.stringify(schemaTemplates.jsonld_templates)]
  );
  console.log("[Agent 2] Saved schema templates");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Schemas saved", detail: "JSON-LD templates stored", timestamp: Date.now() });

  // Step 5: Seasonal calendar
  console.log("[Agent 2] Step 5: Generating seasonal calendar...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Seasonal calendar", detail: "12-month planning", timestamp: Date.now() });
  const seasonalPrompt = SEASONAL_CALENDAR_PROMPT.replace("{niche}", config.niche);
  const seasonalCalendar = await llm.call({
    prompt: seasonalPrompt,
    schema: SeasonalCalendarSchema,
  });
  console.log(
    `[Agent 2] Seasonal focus: ${seasonalCalendar.months
      .slice(0, 4)
      .map((month) => `${month.name}:${month.primary_pests.slice(0, 2).join("/")}`)
      .join(" | ")}`
  );

  await db.query(
    `INSERT INTO seasonal_calendars (niche, months)
     VALUES ($1, $2)
     ON CONFLICT (niche) DO UPDATE SET
       months = EXCLUDED.months`,
    [seasonalCalendar.niche, JSON.stringify(seasonalCalendar.months)]
  );
  console.log("[Agent 2] Saved seasonal calendar");

  console.log("[Agent 2] Design research complete");
}

import { z } from "zod/v4";
import { join } from "node:path";
import { rmSync } from "node:fs";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { DesignSpecSchema } from "../../shared/schemas/design-specs.js";
import { CopyFrameworkSchema } from "../../shared/schemas/copy-frameworks.js";
import { eventBus } from "../../shared/events/event-bus.js";
import {
  buildCheckpointScope,
  createCheckpointTracker,
} from "../../shared/checkpoints.js";
import type { OfferProfile } from "../../shared/offer-profiles.js";
import type { VerticalProfile } from "../../shared/vertical-profiles.js";
import { resolveVerticalStrategy } from "../../shared/vertical-strategies.js";
import {
  DESIGN_RESEARCH_TTL_MS,
  isFreshTimestamp,
  normalizeNiche,
} from "../../shared/cache-policy.js";
import { runResearchPhase } from "./research-orchestrator.js";
import {
  buildCompetitorAnalysisPrompt,
  buildDesignSpecPrompt,
  buildCopyFrameworkPrompt,
  buildSchemaTemplatePrompt,
  buildSeasonalCalendarPrompt,
  type SynthesisPromptContext,
} from "./prompts.js";
import { readResearchFile, validateResearchFile } from "./research-reader.js";
import { withSelfHealing } from "../../shared/self-healing.js";

const AGENT2_COMPETITOR_ANALYSIS_TIMEOUT_MS = 420_000;
const AGENT2_DESIGN_SPEC_TIMEOUT_MS = 180_000;
const AGENT2_COPY_FRAMEWORK_TIMEOUT_MS = 180_000;
const AGENT2_SCHEMA_TEMPLATES_TIMEOUT_MS = 120_000;
const AGENT2_SEASONAL_CALENDAR_TIMEOUT_MS = 180_000;
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
    region_overrides: z.array(z.object({
      region: z.string(),
      notes: z.array(z.string()),
    })).optional(),
  })),
});

export interface Agent2Config {
  niche: string;
  offerProfile?: OfferProfile | null;
  verticalProfile?: VerticalProfile | null;
  forceRefresh?: boolean;
  researchEnabled?: boolean;
  runId?: string;
}

async function hasFreshDesignResearch(niche: string, db: DbClient): Promise<boolean> {
  const cacheKey = normalizeNiche(niche);
  const [designResult, copyResult, schemaResult, seasonalResult] = await Promise.all([
    db.query<{ updated_at: Date; created_at: Date }>(
      "SELECT updated_at, created_at FROM design_specs WHERE niche = $1 LIMIT 1",
      [cacheKey]
    ),
    db.query<{ updated_at: Date; created_at: Date }>(
      "SELECT updated_at, created_at FROM copy_frameworks WHERE niche = $1 LIMIT 1",
      [cacheKey]
    ),
    db.query<{ updated_at: Date | null; created_at: Date }>(
      "SELECT updated_at, created_at FROM schema_templates WHERE niche = $1 LIMIT 1",
      [cacheKey]
    ),
    db.query<{ updated_at: Date | null; created_at: Date }>(
      "SELECT updated_at, created_at FROM seasonal_calendars WHERE niche = $1 LIMIT 1",
      [cacheKey]
    ),
  ]);

  const rows = [
    designResult.rows[0],
    copyResult.rows[0],
    schemaResult.rows[0],
    seasonalResult.rows[0],
  ];

  return rows.every((row) =>
    row &&
    isFreshTimestamp(row.updated_at ?? row.created_at, DESIGN_RESEARCH_TTL_MS)
  );
}

function parseStoredJson<T>(value: T | string): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value;
}

async function loadCheckpointedCompetitorAnalysis(niche: string, db: DbClient) {
  const result = await db.query<{ analysis: unknown }>(
    "SELECT analysis FROM competitor_analyses WHERE niche = $1 LIMIT 1",
    [niche]
  );
  const row = result.rows[0];
  if (!row) return null;
  return CompetitorAnalysisSchema.parse(parseStoredJson(row.analysis));
}

async function loadCheckpointedDesignSpec(niche: string, db: DbClient) {
  const result = await db.query<{
    archetype: string;
    layout: unknown;
    components: unknown;
    colors: unknown;
    typography: unknown;
    responsive_breakpoints: unknown;
  }>(
    `SELECT archetype, layout, components, colors, typography, responsive_breakpoints
     FROM design_specs
     WHERE niche = $1
     LIMIT 1`,
    [niche]
  );
  const row = result.rows[0];
  if (!row) return null;
  return DesignSpecSchema.parse({
    niche,
    archetype: row.archetype,
    layout: parseStoredJson(row.layout),
    components: parseStoredJson(row.components),
    colors: parseStoredJson(row.colors),
    typography: parseStoredJson(row.typography),
    responsive_breakpoints: parseStoredJson(row.responsive_breakpoints),
  });
}

async function loadCheckpointedCopyFramework(niche: string, db: DbClient) {
  const result = await db.query<{
    headlines: unknown;
    ctas: unknown;
    cta_microcopy: unknown;
    trust_signals: unknown;
    guarantees: unknown;
    reading_level: unknown;
    vertical_angles: unknown;
    faq_templates: unknown;
    pas_scripts: unknown;
  }>(
    `SELECT headlines, ctas, cta_microcopy, trust_signals, guarantees,
            reading_level, vertical_angles, faq_templates, pas_scripts
     FROM copy_frameworks
     WHERE niche = $1
     LIMIT 1`,
    [niche]
  );
  const row = result.rows[0];
  if (!row) return null;
  return CopyFrameworkSchema.parse({
    niche,
    headlines: parseStoredJson(row.headlines),
    ctas: parseStoredJson(row.ctas),
    cta_microcopy: parseStoredJson(row.cta_microcopy),
    trust_signals: parseStoredJson(row.trust_signals),
    guarantees: parseStoredJson(row.guarantees),
    reading_level: parseStoredJson(row.reading_level),
    vertical_angles: parseStoredJson(row.vertical_angles),
    faq_templates: parseStoredJson(row.faq_templates),
    pas_scripts: parseStoredJson(row.pas_scripts),
  });
}

async function loadCheckpointedSchemaTemplates(niche: string, db: DbClient) {
  const result = await db.query<{ jsonld_templates: unknown }>(
    "SELECT jsonld_templates FROM schema_templates WHERE niche = $1 LIMIT 1",
    [niche]
  );
  const row = result.rows[0];
  if (!row) return null;
  return SchemaTemplateSchema.parse({
    niche,
    jsonld_templates: parseStoredJson(row.jsonld_templates),
  });
}

async function loadCheckpointedSeasonalCalendar(niche: string, db: DbClient) {
  const result = await db.query<{ months: unknown }>(
    "SELECT months FROM seasonal_calendars WHERE niche = $1 LIMIT 1",
    [niche]
  );
  const row = result.rows[0];
  if (!row) return null;
  return SeasonalCalendarSchema.parse({
    niche,
    months: parseStoredJson(row.months),
  });
}

function countResearchDocuments(ctx: SynthesisPromptContext): number {
  return Object.values(ctx).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  ).length;
}

function loadValidatedResearchContext(researchDir: string): {
  context: SynthesisPromptContext;
  validCount: number;
} {
  const readValid = (fileName: string): string | null => {
    const path = join(researchDir, fileName);
    const content = readResearchFile(path);
    if (!content) return null;
    if (!validateResearchFile(content)) {
      console.warn(`[Agent 2] Ignoring invalid research file: ${fileName}`);
      return null;
    }
    return content;
  };

  const context: SynthesisPromptContext = {
    competitorResearch: readValid("competitors.md"),
    croResearch: readValid("cro-data.md"),
    designResearch: readValid("design.md"),
    copyResearch: readValid("copy.md"),
    schemaResearch: readValid("schema.md"),
    seasonalResearch: readValid("seasonal.md"),
  };

  return {
    context,
    validCount: countResearchDocuments(context),
  };
}

export async function runAgent2(
  config: Agent2Config,
  llm: LlmClient,
  db: DbClient
): Promise<void> {
  try {
  const cacheKey = normalizeNiche(config.niche);
  const checkpointScope = buildCheckpointScope([
    cacheKey,
    config.offerProfile?.constraints ?? null,
  ]);
  const checkpoints = await createCheckpointTracker(
    db,
    "agent-2",
    checkpointScope,
    { reset: Boolean(config.forceRefresh) }
  );
  console.log(`[Agent 2] Starting design research for ${config.niche}`);
  eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Starting", detail: config.niche, timestamp: Date.now() });

  if (checkpoints.has("completed")) {
    console.log(`[Agent 2] Reusing completed checkpoint for ${config.niche}`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Checkpoint hit", detail: "Completed", timestamp: Date.now() });
    return;
  }

  if (config.forceRefresh) {
    console.log("[Agent 2] Force refresh enabled, bypassing design research cache");
  }

  if (!config.forceRefresh && !config.offerProfile && await hasFreshDesignResearch(config.niche, db)) {
    console.log(`[Agent 2] Reusing cached design research for ${config.niche}`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Cache hit", detail: `${config.niche} still fresh`, timestamp: Date.now() });
    return;
  }

  const strategy = resolveVerticalStrategy(
    config.verticalProfile?.vertical_key ?? config.offerProfile?.vertical
  );
  const strategyContext = {
    offerProfile: config.offerProfile,
    verticalProfile: config.verticalProfile,
  };
  console.log(`[Agent 2] Design research missing or stale for ${config.niche}, refreshing`);

  // Phase 1: Deep research via Agent SDK subagents
  const researchDir = join("tmp", "agent2-research", config.offerProfile?.offer_id ?? cacheKey);
  let researchCtx: SynthesisPromptContext = {};
  const logDeepResearchDegraded = (reason: string) => {
    console.error(
      `[Agent 2][DEEP_RESEARCH_DEGRADED] ${config.niche} | researchDir=${researchDir} | reason=${reason} | proceeding_without_research_context=true`
    );
    eventBus.emitEvent({
      type: "agent_step",
      agent: "agent-2",
      step: "Research degraded",
      detail: reason,
      timestamp: Date.now(),
    });
  };
  const runDeepResearch = async (): Promise<void> => {
    console.log("[Agent 2] Phase 1: Running deep research...");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Deep research", detail: "Spawning subagents", timestamp: Date.now() });

    try {
      const findings = await runResearchPhase({ niche: config.niche, researchDir });
      researchCtx = {
        competitorResearch: findings.competitors,
        croResearch: findings.croData,
        designResearch: findings.design,
        copyResearch: findings.copy,
        schemaResearch: findings.schema,
        seasonalResearch: findings.seasonal,
      };

      const validCount = countResearchDocuments(researchCtx);
      if (validCount === 0) {
        logDeepResearchDegraded("No valid findings were produced by deep research");
        researchCtx = {};
        return;
      }

      await checkpoints.mark("research_complete", {
        competitorsWords: findings.competitors?.split(/\s+/).length ?? 0,
        croWords: findings.croData?.split(/\s+/).length ?? 0,
      });
      console.log("[Agent 2] Phase 1 complete");
      eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Research complete", detail: "Phase 2: synthesis", timestamp: Date.now() });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logDeepResearchDegraded(reason);
      researchCtx = {};
    }
  };

  if (config.researchEnabled === false) {
    console.log("[Agent 2] Deep research disabled via config, skipping");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Research skipped", detail: "Disabled via AGENT2_RESEARCH_ENABLED=false", timestamp: Date.now() });
  } else if (!config.forceRefresh && checkpoints.has("research_complete")) {
    console.log("[Agent 2] Reusing checkpointed research findings");
    const reloaded = loadValidatedResearchContext(researchDir);
    if (reloaded.validCount === 0) {
      console.error(
        `[Agent 2][RESEARCH_CHECKPOINT_INVALID] ${config.niche} | researchDir=${researchDir} | action=re_run_deep_research`
      );
      await runDeepResearch();
    } else {
      researchCtx = reloaded.context;
      console.log(`[Agent 2] Reused ${reloaded.validCount} validated research files`);
    }
  } else {
    await runDeepResearch();
  }

  // Step 1: Competitor analysis
  let competitorAnalysis = config.forceRefresh
    ? null
    : await loadCheckpointedCompetitorAnalysis(cacheKey, db);
  if (competitorAnalysis) {
    if (!checkpoints.has("competitor_analysis")) {
      await checkpoints.mark("competitor_analysis", {
        patternCount: competitorAnalysis.patterns.length,
        source: "existing_output",
      });
    }
    console.log("[Agent 2] Reusing checkpointed competitor analysis");
  } else {
    console.log("[Agent 2] Step 1: Running competitor analysis...");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Competitor analysis", detail: "CRO patterns", timestamp: Date.now() });
    const competitorPrompt = buildCompetitorAnalysisPrompt(config.niche, researchCtx);
    let competitorRepairHint = "";
    competitorAnalysis = await withSelfHealing({
      runId: config.runId ?? "no-run-id",
      offerId: config.offerProfile?.offer_id ?? "unknown",
      agentName: "agent-2",
      step: "competitor_analysis",
      fn: async () => {
        const prompt = competitorRepairHint
          ? competitorPrompt + `\n\n[Correction guidance from previous attempt: ${competitorRepairHint}]`
          : competitorPrompt;
        const result = await llm.call({
          prompt,
          schema: CompetitorAnalysisSchema,
          model: "sonnet",
          timeoutMs: AGENT2_COMPETITOR_ANALYSIS_TIMEOUT_MS,
          logLabel: "[Agent 2][Step 1][Competitor analysis]",
        });
        await db.query(
          `INSERT INTO competitor_analyses (niche, analysis)
           VALUES ($1, $2)
           ON CONFLICT (niche) DO UPDATE SET
             analysis = EXCLUDED.analysis,
             updated_at = now()`,
          [cacheKey, JSON.stringify(result)]
        );
        await checkpoints.mark("competitor_analysis", { patternCount: result.patterns.length });
        return result;
      },
      getRepairContext: (err) =>
        `Agent 2 Step 1 (competitor analysis) for niche "${config.niche}" failed with: ${err.message}\n\nReturn corrected JSON matching the CompetitorAnalysis schema with fields: patterns (array of {category, findings, recommendation}), top_cta_patterns, trust_signal_types, layout_order.`,
      applyFix: async (fixedCode) => { competitorRepairHint = fixedCode; },
      db,
      llm,
    });
    console.log(`[Agent 2] Found ${competitorAnalysis.patterns.length} CRO patterns`);
    console.log(
      `[Agent 2] Pattern categories: ${competitorAnalysis.patterns
        .slice(0, 5)
        .map((pattern) => pattern.category)
        .join(" | ")}`
    );
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Patterns found", detail: `${competitorAnalysis.patterns.length} CRO patterns`, timestamp: Date.now() });
  }

  // Step 2: Design specification
  let designSpec = config.forceRefresh
    ? null
    : await loadCheckpointedDesignSpec(cacheKey, db);
  if (designSpec) {
    if (!checkpoints.has("design_spec")) {
      await checkpoints.mark("design_spec", {
        archetype: designSpec.archetype,
        source: "existing_output",
      });
    }
    console.log("[Agent 2] Reusing checkpointed design specification");
  } else {
    console.log("[Agent 2] Step 2: Generating design specification...");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Design spec", detail: "Generating specification", timestamp: Date.now() });
    const designPrompt = buildDesignSpecPrompt(config.niche, JSON.stringify(competitorAnalysis, null, 2), researchCtx);
    let designRepairHint = "";
    designSpec = await withSelfHealing({
      runId: config.runId ?? "no-run-id",
      offerId: config.offerProfile?.offer_id ?? "unknown",
      agentName: "agent-2",
      step: "design_spec",
      fn: async () => {
        const prompt = designRepairHint
          ? designPrompt + `\n\n[Correction guidance from previous attempt: ${designRepairHint}]`
          : designPrompt;
        const result = await llm.call({
          prompt,
          schema: DesignSpecSchema,
          model: "sonnet",
          timeoutMs: AGENT2_DESIGN_SPEC_TIMEOUT_MS,
          logLabel: "[Agent 2][Step 2][Design specification]",
        });
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
            cacheKey,
            result.archetype,
            JSON.stringify(result.layout),
            JSON.stringify(result.components),
            JSON.stringify(result.colors),
            JSON.stringify(result.typography),
            JSON.stringify(result.responsive_breakpoints),
          ]
        );
        await checkpoints.mark("design_spec", { archetype: result.archetype });
        return result;
      },
      getRepairContext: (err) =>
        `Agent 2 Step 2 (design spec) for niche "${config.niche}" failed with: ${err.message}\n\nReturn corrected JSON matching the DesignSpec schema with fields: niche, archetype, layout, components, colors, typography, responsive_breakpoints.`,
      applyFix: async (fixedCode) => { designRepairHint = fixedCode; },
      db,
      llm,
    });
    console.log(`[Agent 2] Design archetype: ${designSpec.archetype}`);
    console.log(
      `[Agent 2] Layout sections: ${Object.keys(designSpec.layout).slice(0, 6).join(" | ")}`
    );
    console.log("[Agent 2] Saved design spec");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Spec saved", detail: "Design specification stored", timestamp: Date.now() });
  }

  // Step 3: Copy framework
  let copyFramework = config.forceRefresh
    ? null
    : await loadCheckpointedCopyFramework(cacheKey, db);
  if (copyFramework) {
    if (!checkpoints.has("copy_framework")) {
      await checkpoints.mark("copy_framework", {
        headlineCount: copyFramework.headlines.length,
        source: "existing_output",
      });
    }
    console.log("[Agent 2] Reusing checkpointed copy framework");
  } else {
    console.log("[Agent 2] Step 3: Generating copy framework...");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Copy framework", detail: "Headlines, CTAs, trust signals", timestamp: Date.now() });
    const copyPrompt = buildCopyFrameworkPrompt(config.niche, researchCtx);
    let copyRepairHint = "";
    copyFramework = await withSelfHealing({
      runId: config.runId ?? "no-run-id",
      offerId: config.offerProfile?.offer_id ?? "unknown",
      agentName: "agent-2",
      step: "copy_framework",
      fn: async () => {
        const prompt = copyRepairHint
          ? copyPrompt + `\n\n[Correction guidance from previous attempt: ${copyRepairHint}]`
          : copyPrompt;
        const result = await llm.call({
          prompt,
          schema: CopyFrameworkSchema,
          model: "sonnet",
          timeoutMs: AGENT2_COPY_FRAMEWORK_TIMEOUT_MS,
          logLabel: "[Agent 2][Step 3][Copy framework]",
        });
        await db.query(
          `INSERT INTO copy_frameworks (
             niche, headlines, ctas, cta_microcopy, trust_signals, guarantees, reading_level, vertical_angles, faq_templates, pas_scripts
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (niche) DO UPDATE SET
             headlines = EXCLUDED.headlines,
             ctas = EXCLUDED.ctas,
             cta_microcopy = EXCLUDED.cta_microcopy,
             trust_signals = EXCLUDED.trust_signals,
             guarantees = EXCLUDED.guarantees,
             reading_level = EXCLUDED.reading_level,
             vertical_angles = EXCLUDED.vertical_angles,
             faq_templates = EXCLUDED.faq_templates,
             pas_scripts = EXCLUDED.pas_scripts,
             updated_at = now()`,
          [
            cacheKey,
            JSON.stringify(result.headlines),
            JSON.stringify(result.ctas),
            JSON.stringify(result.cta_microcopy),
            JSON.stringify(result.trust_signals),
            JSON.stringify(result.guarantees),
            JSON.stringify(result.reading_level),
            JSON.stringify(result.vertical_angles),
            JSON.stringify(result.faq_templates),
            JSON.stringify(result.pas_scripts),
          ]
        );
        await checkpoints.mark("copy_framework", { headlineCount: result.headlines.length });
        return result;
      },
      getRepairContext: (err) =>
        `Agent 2 Step 3 (copy framework) for niche "${config.niche}" failed with: ${err.message}\n\nReturn corrected JSON matching the CopyFramework schema with fields: niche, headlines, ctas, cta_microcopy, trust_signals, guarantees, reading_level, vertical_angles, faq_templates, pas_scripts.`,
      applyFix: async (fixedCode) => { copyRepairHint = fixedCode; },
      db,
      llm,
    });
    console.log(
      `[Agent 2] Headline directions: ${copyFramework.headlines.slice(0, 4).join(" | ")}`
    );
    console.log(`[Agent 2] CTA variants: ${copyFramework.ctas.slice(0, 4).join(" | ")}`);
    console.log("[Agent 2] Saved copy framework");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Copy saved", detail: "Copy framework stored", timestamp: Date.now() });
  }

  // Step 4: Schema templates (JSON-LD)
  let schemaTemplates = config.forceRefresh
    ? null
    : await loadCheckpointedSchemaTemplates(cacheKey, db);
  if (schemaTemplates) {
    if (!checkpoints.has("schema_templates")) {
      await checkpoints.mark("schema_templates", {
        templateTypes: Object.keys(schemaTemplates.jsonld_templates).length,
        source: "existing_output",
      });
    }
    console.log("[Agent 2] Reusing checkpointed schema templates");
  } else {
    console.log("[Agent 2] Step 4: Generating schema templates...");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Schema templates", detail: "JSON-LD generation", timestamp: Date.now() });
    const schemaPrompt = buildSchemaTemplatePrompt(config.niche, researchCtx);
    let schemaRepairHint = "";
    schemaTemplates = await withSelfHealing({
      runId: config.runId ?? "no-run-id",
      offerId: config.offerProfile?.offer_id ?? "unknown",
      agentName: "agent-2",
      step: "schema_templates",
      fn: async () => {
        const prompt = schemaRepairHint
          ? schemaPrompt + `\n\n[Correction guidance from previous attempt: ${schemaRepairHint}]`
          : schemaPrompt;
        const result = await llm.call({
          prompt,
          schema: SchemaTemplateSchema,
          model: "haiku",
          timeoutMs: AGENT2_SCHEMA_TEMPLATES_TIMEOUT_MS,
          logLabel: "[Agent 2][Step 4][Schema templates]",
        });
        await db.query(
          `INSERT INTO schema_templates (niche, jsonld_templates)
           VALUES ($1, $2)
           ON CONFLICT (niche) DO UPDATE SET
             jsonld_templates = EXCLUDED.jsonld_templates,
             updated_at = now()`,
          [cacheKey, JSON.stringify(result.jsonld_templates)]
        );
        await checkpoints.mark("schema_templates", { templateTypes: Object.keys(result.jsonld_templates).length });
        return result;
      },
      getRepairContext: (err) =>
        `Agent 2 Step 4 (schema templates) for niche "${config.niche}" failed with: ${err.message}\n\nReturn corrected JSON matching the SchemaTemplate schema with fields: niche, jsonld_templates (record of schema type to JSON-LD template object).`,
      applyFix: async (fixedCode) => { schemaRepairHint = fixedCode; },
      db,
      llm,
    });
    console.log(
      `[Agent 2] Schema template types: ${Object.keys(schemaTemplates.jsonld_templates)
        .slice(0, 6)
        .join(" | ")}`
    );
    console.log("[Agent 2] Saved schema templates");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Schemas saved", detail: "JSON-LD templates stored", timestamp: Date.now() });
  }

  // Step 5: Seasonal calendar
  let seasonalCalendar = config.forceRefresh
    ? null
    : await loadCheckpointedSeasonalCalendar(cacheKey, db);
  if (seasonalCalendar) {
    if (!checkpoints.has("seasonal_calendar")) {
      await checkpoints.mark("seasonal_calendar", {
        monthCount: seasonalCalendar.months.length,
        source: "existing_output",
      });
    }
    console.log("[Agent 2] Reusing checkpointed seasonal calendar");
  } else {
    console.log("[Agent 2] Step 5: Generating seasonal calendar...");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-2", step: "Seasonal calendar", detail: "12-month planning", timestamp: Date.now() });
    const seasonalPrompt = buildSeasonalCalendarPrompt(config.niche, researchCtx);
    let seasonalRepairHint = "";
    seasonalCalendar = await withSelfHealing({
      runId: config.runId ?? "no-run-id",
      offerId: config.offerProfile?.offer_id ?? "unknown",
      agentName: "agent-2",
      step: "seasonal_calendar",
      fn: async () => {
        const prompt = seasonalRepairHint
          ? seasonalPrompt + `\n\n[Correction guidance from previous attempt: ${seasonalRepairHint}]`
          : seasonalPrompt;
        const result = await llm.call({
          prompt,
          schema: SeasonalCalendarSchema,
          model: "sonnet",
          timeoutMs: AGENT2_SEASONAL_CALENDAR_TIMEOUT_MS,
          logLabel: "[Agent 2][Step 5][Seasonal calendar]",
        });
        await db.query(
          `INSERT INTO seasonal_calendars (niche, months)
           VALUES ($1, $2)
           ON CONFLICT (niche) DO UPDATE SET
             months = EXCLUDED.months,
             updated_at = now()`,
          [cacheKey, JSON.stringify(result.months)]
        );
        await checkpoints.mark("seasonal_calendar", { monthCount: result.months.length });
        return result;
      },
      getRepairContext: (err) =>
        `Agent 2 Step 5 (seasonal calendar) for niche "${config.niche}" failed with: ${err.message}\n\nReturn corrected JSON matching the SeasonalCalendar schema with fields: niche, months (array of {month, name, primary_pests, content_topics, messaging_priority, seasonal_keywords, region_overrides?}).`,
      applyFix: async (fixedCode) => { seasonalRepairHint = fixedCode; },
      db,
      llm,
    });
    console.log(
      `[Agent 2] Seasonal focus: ${seasonalCalendar.months
        .slice(0, 4)
        .map((month) => `${month.name}:${month.primary_pests.slice(0, 2).join("/")}`)
        .join(" | ")}`
    );
    console.log("[Agent 2] Saved seasonal calendar");
  }

  await checkpoints.mark("completed", {
    niche: cacheKey,
  });

  // Clean up research temp files after successful synthesis
  try {
    rmSync(researchDir, { recursive: true, force: true });
    console.log("[Agent 2] Research temp files cleaned up");
  } catch {
    // Non-fatal — temp files can linger
  }

  console.log("[Agent 2] Design research complete");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    eventBus.emitEvent({
      type: "agent_error",
      agent: "agent-2",
      error: reason,
      timestamp: Date.now(),
    });
    throw error;
  }
}

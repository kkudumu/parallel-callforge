import { z } from "zod/v4";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { withSelfHealing } from "../../shared/self-healing.js";
import type { CitySourceMode } from "../../config/env.js";
import { KeywordClusterSchema } from "../../shared/schemas/keyword-clusters.js";
import { createGoogleKpClient } from "./google-kp.js";
import { eventBus } from "../../shared/events/event-bus.js";
import {
  buildCheckpointScope,
  createCheckpointTracker,
} from "../../shared/checkpoints.js";
import type { OfferProfile } from "../../shared/offer-profiles.js";
import type { VerticalProfile } from "../../shared/vertical-profiles.js";
import { resolveVerticalStrategy } from "../../shared/vertical-strategies.js";
import {
  getCityResearchFingerprint,
  getCityScoringFingerprint,
  isFreshTimestamp,
  KEYWORD_RESEARCH_TTL_MS,
  normalizeNiche,
  selectTopCities,
  type ScoredCity,
} from "../../shared/cache-policy.js";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { runResearchPhase, type ResearchFindings } from "./research-orchestrator.js";
import {
  buildResearchContext,
  validatePlaybookFile,
} from "./research-reader.js";
import {
  buildPlaybookSynthesisPrompt,
  withResearchContext,
} from "./prompts.js";
// Schema for playbook synthesis (wraps markdown string for LLM structured output)
const PlaybookTextSchema = z.object({
  markdown: z.string(),
});
const DEFAULT_MIN_VALID_RESEARCH_FILES = 4;
const MAX_PLAYBOOK_RESEARCH_CONTEXT_CHARS = 120_000;

// Schema for LLM keyword template generation
const KeywordTemplatesResponseSchema = z.object({
  templates: z.array(z.string()).min(10).max(40),
});

// Schema for LLM city scoring
const CityScoringResponseSchema = z.object({
  scored_cities: z.array(
    z.object({
      city: z.string(),
      state: z.string(),
      population: z.number(),
      priority_score: z.number().min(0).max(100),
      reasoning: z.string(),
    })
  ),
});

const IntentSchema = z.enum([
  "informational",
  "transactional",
  "navigational",
  "commercial",
]);

// Strict schema compatible with Claude structured output (no anyOf, no
// propertyNames, no open additionalProperties).
const KeywordClusteringResponseSchema = z.object({
  clusters: z.array(
    z.object({
      cluster_name: z.string(),
      primary_keyword: z.string(),
      secondary_keywords: z.array(z.string()),
      search_volume: z.number(),
      difficulty: z.number(),
      intent: z.string(),
    })
  ),
});

/** Build url_mapping deterministically from cluster data. */
function buildUrlMapping(
  clusters: Array<{ cluster_name: string; primary_keyword: string }>,
  citySlug: string,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  mapping[`/${citySlug}/`] = clusters[0]?.primary_keyword ?? citySlug;
  for (const cluster of clusters) {
    const serviceSlug = slugify(cluster.cluster_name);
    if (serviceSlug && serviceSlug !== citySlug) {
      mapping[`/${citySlug}/${serviceSlug}/`] = cluster.primary_keyword;
    }
  }
  return mapping;
}

function isServiceAllowed(
  value: string,
  offerProfile?: OfferProfile | null,
  verticalProfile?: VerticalProfile | null
): boolean {
  const strategy = resolveVerticalStrategy(verticalProfile?.vertical_key ?? offerProfile?.vertical);
  return strategy.isServiceAllowed(value, {
    offerProfile,
    verticalProfile,
  });
}

function filterKeywordTemplates(
  templates: string[],
  offerProfile?: OfferProfile | null
): string[] {
  if (!offerProfile?.constraints) {
    return templates;
  }

  const filtered = templates.filter((template) => isServiceAllowed(template, offerProfile));
  return filtered.length > 0 ? filtered : templates;
}

function normalizeUrlMappingValue(key: string, value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    const candidates = [
      node.url, node.path, node.slug, node.href, node.target,
      node.primary_keyword, node.keyword, node.cluster_name, node.name, node.title,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
  }

  return key;
}

export function normalizeUrlMapping(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const mapping: Record<string, string> = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    mapping[key] = normalizeUrlMappingValue(key, value);
  }

  return mapping;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function expandKeywordTemplates(
  templates: string[],
  cities: string[]
): string[] {
  const expanded: string[] = [];
  for (const city of cities) {
    const citySlug = slugify(city);
    for (const template of templates) {
      expanded.push(
        template
          .replace(/\{city\}/g, city)
          .replace(/\{city_slug\}/g, citySlug)
      );
    }
  }
  return expanded;
}

function summarizeCityScoringLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;

    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }

    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }

    if (parsed.type === "item.completed") {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item && typeof item.text === "string" && item.text.trim()) {
        return item.text.trim();
      }
    }

    if (parsed.type === "result" && parsed.structured_output) {
      return "Structured scoring response received";
    }

    if (typeof parsed.type === "string") {
      return `LLM event: ${parsed.type}`;
    }
  } catch {
    return trimmed;
  }

  return null;
}

function formatReasoning(reasoning: string): string {
  return reasoning.replace(/\s+/g, " ").trim();
}

function formatDbErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const pgError = error as Error & {
    code?: string;
    detail?: string;
    hint?: string;
    where?: string;
    table?: string;
    constraint?: string;
  };

  const details = [pgError.message];
  if (pgError.code) {
    details.push(`code=${pgError.code}`);
  }
  if (pgError.table) {
    details.push(`table=${pgError.table}`);
  }
  if (pgError.constraint) {
    details.push(`constraint=${pgError.constraint}`);
  }
  if (pgError.detail) {
    details.push(`detail=${pgError.detail}`);
  }
  if (pgError.hint) {
    details.push(`hint=${pgError.hint}`);
  }
  if (pgError.where) {
    details.push(`where=${pgError.where}`);
  }

  return details.join(" | ");
}

function createStreamingLogger(prefix: string) {
  const partials: Record<"stdout" | "stderr", string> = {
    stdout: "",
    stderr: "",
  };

  return {
    onOutput(chunk: string, stream: "stdout" | "stderr") {
      const combined = partials[stream] + chunk;
      const lines = combined.split(/\r?\n/);
      partials[stream] = lines.pop() ?? "";

      for (const line of lines) {
        const summary = summarizeCityScoringLine(line);
        if (!summary) {
          continue;
        }

        if (stream === "stderr") {
          console.warn(`${prefix} ${summary}`);
        } else {
          console.log(`${prefix} ${summary}`);
        }
      }
    },
    flush() {
      for (const stream of ["stdout", "stderr"] as const) {
        const summary = summarizeCityScoringLine(partials[stream]);
        if (!summary) {
          continue;
        }

        if (stream === "stderr") {
          console.warn(`${prefix} ${summary}`);
        } else {
          console.log(`${prefix} ${summary}`);
        }

        partials[stream] = "";
      }
    },
  };
}

export interface Agent1Config {
  niche: string;
  offerProfile?: OfferProfile | null;
  verticalProfile?: VerticalProfile | null;
  candidateCities?: Array<{
    city: string;
    state: string;
    population: number;
    market_type?: string;
    cluster?: {
      id: string;
      population: number;
      city_count: number;
      anchor_city: string;
      anchor_state: string;
      anchor_population: number;
      distance_miles?: number | null;
    } | null;
    metro_parent?: {
      city: string;
      state: string;
      population: number;
      distance_miles?: number | null;
    } | null;
  }>;
  offerId?: string;
  runId?: string;
  topCandidateLimit?: number;
  citySource?: CitySourceMode;
  payoutPerQualifiedCall?: number;
  forceRefresh?: boolean;
  researchEnabled?: boolean;   // default: true (all entry points enable by default)
  researchDir?: string;        // default: tmp/agent1-research/{runId}
  minValidResearchFiles?: number; // default: 4
  cleanupResearchDir?: boolean; // default: true
}

function clampResearchContext(input: string): { value: string; truncated: boolean } {
  if (input.length <= MAX_PLAYBOOK_RESEARCH_CONTEXT_CHARS) {
    return { value: input, truncated: false };
  }

  const suffix = "\n\n[TRUNCATED: research context exceeded prompt safety limit]";
  const budget = Math.max(0, MAX_PLAYBOOK_RESEARCH_CONTEXT_CHARS - suffix.length);
  return {
    value: `${input.slice(0, budget)}${suffix}`,
    truncated: true,
  };
}

export async function loadCandidateCitiesFromDeploymentCandidates(
  offerId: string,
  db: DbClient,
  topCandidateLimit = 5
): Promise<Array<{
  city: string;
  state: string;
  population: number;
  market_type?: string;
  cluster?: {
    id: string;
    population: number;
    city_count: number;
    anchor_city: string;
    anchor_state: string;
    anchor_population: number;
    distance_miles?: number | null;
  } | null;
  metro_parent?: {
    city: string;
    state: string;
    population: number;
    distance_miles?: number | null;
  } | null;
}>> {
  console.log(
    `[Agent 1] Loading up to ${Math.max(1, topCandidateLimit)} deployment candidates for offer ${offerId}...`
  );
  const result = await db.query<{
    city: string;
    state: string;
    population: number;
    market_type: string | null;
    cluster:
      | {
          id: string;
          population: number;
          city_count: number;
          anchor_city: string;
          anchor_state: string;
          anchor_population: number;
          distance_miles?: number | null;
        }
      | null;
    metro_parent:
      | {
          city: string;
          state: string;
          population: number;
          distance_miles?: number | null;
        }
      | null;
  }>(
    `SELECT city,
            state,
            population,
            reasoning->>'market_type' AS market_type,
            reasoning->'cluster' AS cluster,
            reasoning->'metro_parent' AS metro_parent
     FROM deployment_candidates
     WHERE offer_id = $1
       AND status IN ('pending', 'researched', 'approved', 'deployed')
     ORDER BY
       COALESCE((reasoning->>'queue_position')::int, 999999),
       CASE
         WHEN reasoning->>'market_type' = 'standalone_city' THEN 0
         WHEN reasoning->>'market_type' = 'suburb' THEN 1
         WHEN reasoning->>'market_type' = 'metro_parent' THEN 2
         ELSE 3
       END,
       pre_keyword_score DESC,
       eligible_zip_count DESC,
       city ASC,
       state ASC
     LIMIT $2`,
    [
      offerId,
      Math.max(1, topCandidateLimit),
    ]
  );

  console.log(
    `[Agent 1] Loaded ${result.rows.length} deployment candidates for offer ${offerId}`
  );

  return result.rows.map((row) => ({
    city: row.city,
    state: row.state,
    population: row.population,
    market_type: row.market_type ?? undefined,
    cluster: row.cluster ?? null,
    metro_parent: row.metro_parent ?? null,
  }));
}

export async function getKeywordTemplates(
  niche: string,
  llm: LlmClient,
  db: DbClient,
  forceRefresh = false,
  offerProfile?: OfferProfile | null,
  verticalProfile?: VerticalProfile | null,
  researchContext?: string | null,
  runId?: string,
  offerId?: string
): Promise<string[]> {
  const cacheKey = normalizeNiche(niche);
  console.log(`[Agent 1] Checking keyword template cache for ${cacheKey}...`);
  const cached = await db.query<{ templates: string[]; updated_at: Date }>(
    `SELECT templates
          , updated_at
     FROM keyword_templates
     WHERE niche = $1
     LIMIT 1`,
    [cacheKey]
  );

  const cachedTemplates = cached.rows[0]?.templates;
  const isFresh = cached.rows[0]
    ? cached.rows[0].updated_at
      ? isFreshTimestamp(cached.rows[0].updated_at, KEYWORD_RESEARCH_TTL_MS)
      : true
    : false;
  const effectiveForceRefresh = forceRefresh || Boolean(researchContext);
  if (!effectiveForceRefresh && Array.isArray(cachedTemplates) && cachedTemplates.length > 0 && isFresh) {
    console.log(`[Agent 1] Reusing ${cachedTemplates.length} cached keyword templates`);
    return filterKeywordTemplates(cachedTemplates, offerProfile);
  }

  console.log("[Agent 1] Keyword templates missing or stale, refreshing...");
  const strategy = resolveVerticalStrategy(verticalProfile?.vertical_key ?? offerProfile?.vertical);
  const templatePrompt = strategy.getKeywordTemplatePrompt(niche, {
    offerProfile,
    verticalProfile,
  });
  let templateRepairHint = "";
  const { templates } = await withSelfHealing({
    runId: runId ?? "no-run-id",
    offerId: offerId ?? "unknown",
    agentName: "agent-1",
    step: "keyword_templates",
    fn: async () => {
      const prompt = templateRepairHint
        ? withResearchContext(templatePrompt, researchContext ?? null) +
          `\n\n[Correction guidance: ${templateRepairHint}]`
        : withResearchContext(templatePrompt, researchContext ?? null);
      return llm.call({
        prompt,
        schema: KeywordTemplatesResponseSchema,
        model: "haiku",
        logLabel: "[Agent 1][Step 1][Keyword templates]",
      });
    },
    getRepairContext: (err) =>
      `Keyword template generation failed for niche "${niche}" with: ${err.message}\n\nReturn JSON with field: templates (string[]). Each template should be a keyword pattern like "[city] pest control".`,
    applyFix: async (fixedCode) => {
      templateRepairHint = fixedCode;
    },
    db,
    llm,
  });

  console.log(`[Agent 1] Saving ${templates.length} keyword templates...`);
  const retrievalMethod = researchContext ? "research-grounded" : "generated";
  const confidenceScore = researchContext ? 0.90 : 0.65;
  await db.query(
    `INSERT INTO keyword_templates
     (niche, templates, cache_provider, cache_version, retrieval_method, confidence_score, updated_at)
     VALUES ($1, $2, 'llm', 'v1', $3, $4, now())
     ON CONFLICT (niche)
     DO UPDATE SET
       templates = EXCLUDED.templates,
       cache_provider = EXCLUDED.cache_provider,
       cache_version = EXCLUDED.cache_version,
       retrieval_method = EXCLUDED.retrieval_method,
       confidence_score = EXCLUDED.confidence_score,
       updated_at = now()`,
    [cacheKey, templates, retrievalMethod, confidenceScore]
  );
  console.log("[Agent 1] Keyword templates saved");

  return filterKeywordTemplates(templates, offerProfile);
}

async function getScoredCities(
  config: Agent1Config,
  templates: string[],
  metrics: unknown[],
  llm: LlmClient,
  db: DbClient,
  forceRefresh = false,
  researchContext?: string | null
): Promise<ScoredCity[]> {
  const candidateCities = config.candidateCities ?? [];
  const cacheKey = normalizeNiche(config.niche);
  const inputFingerprint = getCityScoringFingerprint(candidateCities, templates);
  console.log(
    `[Agent 1] Checking city scoring cache for ${candidateCities.length} candidate cities...`
  );
  const cached = await db.query<{ scored_cities: ScoredCity[]; updated_at: Date }>(
    `SELECT scored_cities, updated_at
     FROM city_scoring_cache
     WHERE niche = $1
       AND input_fingerprint = $2
     LIMIT 1`,
    [cacheKey, inputFingerprint]
  );

  const cachedScores = cached.rows[0]?.scored_cities;
  if (
    !forceRefresh &&
    Array.isArray(cachedScores) &&
    cachedScores.length > 0 &&
    isFreshTimestamp(cached.rows[0]?.updated_at, KEYWORD_RESEARCH_TTL_MS)
  ) {
    console.log(`[Agent 1] Reusing cached city scoring for ${cachedScores.length} cities`);
    return cachedScores;
  }

  console.log("[Agent 1] City scoring cache missing or stale, refreshing...");
  for (const [index, city] of candidateCities.entries()) {
    console.log(
      `[Agent 1] Queueing city ${index + 1}/${candidateCities.length} for scoring: ${city.city}, ${city.state} (pop ${city.population.toLocaleString("en-US")})`
    );
  }
  const strategy = resolveVerticalStrategy(
    config.verticalProfile?.vertical_key ?? config.offerProfile?.vertical
  );
  const scoringPrompt = strategy.getCityScoringPrompt(
    {
      cityData: JSON.stringify(candidateCities, null, 2),
      keywordData: JSON.stringify(metrics.slice(0, 100), null, 2),
    },
    {
      offerProfile: config.offerProfile,
      verticalProfile: config.verticalProfile,
    }
  );

  const scoringLogger = createStreamingLogger("[Agent 1][city-scoring]");
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    console.log(
      `[Agent 1] City scoring still running... ${elapsedSeconds}s elapsed for ${candidateCities.length} candidates`
    );
  }, 5000);

  let scored_cities: ScoredCity[] = [];
  let scoringRepairHint = "";
  try {
    ({ scored_cities } = await withSelfHealing({
      runId: config.runId ?? "no-run-id",
      offerId: config.offerId ?? "unknown",
      agentName: "agent-1",
      step: "city_scoring",
      fn: async () => {
        const prompt = scoringRepairHint
          ? withResearchContext(scoringPrompt, researchContext ?? null) +
            `\n\n[Correction guidance: ${scoringRepairHint}]`
          : withResearchContext(scoringPrompt, researchContext ?? null);
        return llm.call({
          prompt,
          schema: CityScoringResponseSchema,
          model: "haiku",
          onOutput: (chunk, stream) => scoringLogger.onOutput(chunk, stream),
        });
      },
      getRepairContext: (err) =>
        `City scoring failed for niche "${config.niche}" with: ${err.message}\n\nReturn JSON with field: scored_cities (array of {city, state, priority_score, reasoning}).`,
      applyFix: async (fixedCode) => {
        scoringRepairHint = fixedCode;
      },
      db,
      llm,
    }));
  } finally {
    clearInterval(heartbeat);
    scoringLogger.flush();
  }

  const totalElapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  console.log(
    `[Agent 1] City scoring completed in ${totalElapsedSeconds}s for ${scored_cities.length} cities`
  );
  for (const [index, city] of scored_cities.entries()) {
    console.log(
      `[Agent 1] Scored city ${index + 1}/${scored_cities.length}: ${city.city}, ${city.state} -> ${city.priority_score}/100 (${formatReasoning(city.reasoning ?? "No reasoning provided")})`
    );
  }

  console.log(
    `[Agent 1] Saving city scoring cache for ${scored_cities.length} cities...`
  );
  await db.query(
    `INSERT INTO city_scoring_cache
     (niche, input_fingerprint, candidate_cities, scored_cities, cache_source,
      cache_provider, cache_version, retrieval_method, confidence_score, updated_at)
     VALUES ($1, $2, $3, $4, 'estimated', 'llm', 'v1', 'estimated', 0.55, now())
     ON CONFLICT (niche) DO UPDATE SET
       input_fingerprint = EXCLUDED.input_fingerprint,
       candidate_cities = EXCLUDED.candidate_cities,
       scored_cities = EXCLUDED.scored_cities,
       cache_source = EXCLUDED.cache_source,
       cache_provider = EXCLUDED.cache_provider,
       cache_version = EXCLUDED.cache_version,
       retrieval_method = EXCLUDED.retrieval_method,
       confidence_score = EXCLUDED.confidence_score,
       updated_at = now()`,
    [
      cacheKey,
      inputFingerprint,
      JSON.stringify(candidateCities),
      JSON.stringify(scored_cities),
    ]
  );
  console.log("[Agent 1] City scoring cache saved");

  return scored_cities;
}

async function getCachedCityResearch(
  config: Agent1Config,
  city: ScoredCity,
  templates: string[],
  db: DbClient
): Promise<boolean> {
  if (config.forceRefresh) {
    return false;
  }

  const researchFingerprint = getCityResearchFingerprint(
    config.niche,
    city.city,
    city.state,
    templates
  );
  console.log(`[Agent 1] Checking cached keyword clusters for ${city.city}, ${city.state}...`);
  const result = await db.query<{
    id: string;
    keyword_cluster_ids: string[];
    research_fingerprint: string | null;
    updated_at: Date;
  }>(
    `SELECT id, keyword_cluster_ids, research_fingerprint, updated_at
     FROM city_keyword_map
     WHERE city = $1
       AND state = $2
       AND niche = $3
     LIMIT 1`,
    [city.city, city.state, normalizeNiche(config.niche)]
  );

  const row = result.rows[0];
  if (!row) {
    console.log(`[Agent 1] No cached keyword clusters found for ${city.city}, ${city.state}`);
    return false;
  }

  const isFresh =
    row.research_fingerprint === researchFingerprint &&
    isFreshTimestamp(row.updated_at, KEYWORD_RESEARCH_TTL_MS);
  if (!isFresh) {
    console.log(`[Agent 1] Cached keyword clusters stale for ${city.city}, ${city.state}`);
    return false;
  }

  const clusterIds = Array.isArray(row.keyword_cluster_ids) ? row.keyword_cluster_ids : [];
  if (clusterIds.length === 0) {
    console.log(`[Agent 1] Cached keyword cluster map empty for ${city.city}, ${city.state}`);
    return false;
  }

  console.log(
    `[Agent 1] Verifying ${clusterIds.length} cached keyword clusters for ${city.city}, ${city.state}...`
  );
  const clusters = await db.query<{ id: string }>(
    "SELECT id FROM keyword_clusters WHERE id = ANY($1::uuid[])",
    [clusterIds]
  );

  if (clusters.rows.length !== clusterIds.length) {
    console.log(
      `[Agent 1] Cached keyword clusters incomplete for ${city.city}, ${city.state} (${clusters.rows.length}/${clusterIds.length})`
    );
    return false;
  }

  console.log(`[Agent 1] Reusing cached keyword clusters for ${city.city}, ${city.state}`);
  return true;
}

export async function runAgent1(
  config: Agent1Config,
  llm: LlmClient,
  db: DbClient
): Promise<void> {
  const candidateCities =
    config.citySource !== "deployment_candidates" &&
    Array.isArray(config.candidateCities) &&
    config.candidateCities.length > 0
      ? config.candidateCities
      : config.offerId
        ? await loadCandidateCitiesFromDeploymentCandidates(
            config.offerId,
            db,
            config.topCandidateLimit ?? 5
          )
        : [];

  if (candidateCities.length === 0) {
    if (config.offerId) {
      throw new Error(
        `Agent 1 found no deployment candidates for offer ${config.offerId}. ` +
        "Run Agent 0.5 first or verify that deployment_candidates contains rows for this offer."
      );
    }

    throw new Error("Agent 1 requires candidateCities or a deployment candidate offerId");
  }

  const resolvedConfig: Agent1Config = {
    ...config,
    candidateCities,
  };
  const checkpointScope = buildCheckpointScope([
    normalizeNiche(config.niche),
    config.offerId ?? null,
    config.offerProfile?.constraints ?? null,
    config.payoutPerQualifiedCall ?? null,
    candidateCities.map((city) => ({
      city: city.city,
      state: city.state,
      population: city.population,
    })),
  ]);
  const checkpoints = await createCheckpointTracker(
    db,
    "agent-1",
    checkpointScope,
    { reset: Boolean(config.forceRefresh) }
  );
  if (checkpoints.has("completed")) {
    console.log("[Agent 1] Reusing completed checkpoint for this candidate set");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Checkpoint hit", detail: "Completed", timestamp: Date.now() });
    return;
  }

  console.log(`[Agent 1] Starting keyword research for ${config.niche}`);
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Starting", detail: config.niche, timestamp: Date.now() });
  if (config.forceRefresh) {
    console.log("[Agent 1] Force refresh enabled, bypassing keyword research caches");
  }

  // Phase 1: Deep research (optional — enabled via config.researchEnabled)
  let researchFindings: ResearchFindings | null = null;
  let playbookContent: string | null = null;
  let researchContextForTemplates: string | null = null;
  let researchContextForScoring: string | null = null;
  let researchContextForClustering: string | null = null;
  let researchDirToCleanup: string | null = null;

  try {
    if (config.researchEnabled) {
      const runId = config.runId ?? `agent1-${Date.now()}`;
      const researchDir = config.researchDir ?? join("tmp", "agent1-research", runId);
      researchDirToCleanup = researchDir;
      console.log("[Agent 1] Phase 1: Starting deep research...");
      eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Research phase", detail: "Starting", timestamp: Date.now() });

      const minValidFiles = Math.max(
        1,
        Math.min(6, config.minValidResearchFiles ?? DEFAULT_MIN_VALID_RESEARCH_FILES)
      );
      try {
        researchFindings = await runResearchPhase({
          niche: config.niche,
          researchDir,
          minValidFiles,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `[Agent 1][DEEP_RESEARCH_DEGRADED] ${config.niche} | runId=${runId} | researchDir=${researchDir} | reason=${reason} | proceeding_with=no_research_context`
        );
        eventBus.emitEvent({
          type: "agent_step",
          agent: "agent-1",
          step: "Research degraded",
          detail: `Falling back to non-research mode: ${reason}`,
          timestamp: Date.now(),
        });
        researchFindings = null;
      }

      if (!researchFindings) {
        console.log("[Agent 1] Phase 1: Research unavailable — continuing without research context");
      } else {
      const validCount = Object.values(researchFindings).filter(Boolean).length;
      console.log(`[Agent 1] Phase 1: Research complete — ${validCount}/6 files valid`);

      // Phase 2a: Synthesize playbook from research findings
      console.log("[Agent 1] Phase 2a: Synthesizing market selection playbook...");
      const allResearchContext = buildResearchContext({
        "keyword-patterns": researchFindings.keywordPatterns,
        "market-data": researchFindings.marketData,
        "competitor-keywords": researchFindings.competitorKeywords,
        "local-seo": researchFindings.localSeo,
        "ppc-economics": researchFindings.ppcEconomics,
        "gbp-competition": researchFindings.gbpCompetition,
      });
      const boundedContext = clampResearchContext(allResearchContext);
      if (boundedContext.truncated) {
        console.warn(
          `[Agent 1] Research context exceeded ${MAX_PLAYBOOK_RESEARCH_CONTEXT_CHARS} chars and was truncated for playbook synthesis`
        );
      }

      const playbookPrompt = buildPlaybookSynthesisPrompt({
        niche: config.niche,
        researchContext: boundedContext.value,
        runId,
      });

      let playbookRepairHint = "";
      try {
        const playbookResult = await withSelfHealing({
          runId: config.runId ?? "no-run-id",
          offerId: config.offerId ?? "unknown",
          agentName: "agent-1",
          step: "playbook_synthesis",
          fn: async () => {
            const prompt = playbookRepairHint
              ? playbookPrompt + `\n\n[Correction guidance from previous attempt: ${playbookRepairHint}]`
              : playbookPrompt;
            return llm.call({
              prompt,
              schema: PlaybookTextSchema,
              model: "sonnet",
              logLabel: "[Agent 1][Phase 2a][Playbook synthesis]",
            });
          },
          getRepairContext: (err) =>
            `Playbook synthesis failed for niche "${config.niche}" with: ${err.message}\n\nReturn JSON with one field: markdown (string). The markdown must include all required sections and preserve valid markdown formatting.`,
          applyFix: async (fixedCode) => {
            playbookRepairHint = fixedCode;
          },
          db,
          llm,
        });
        playbookContent = playbookResult.markdown;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `[Agent 1][PLAYBOOK_SYNTHESIS_DEGRADED] ${config.niche} | runId=${runId} | reason=${reason} | proceeding_with=focused_research_context_only`
        );
        playbookContent = null;
      }

      if (playbookContent && !validatePlaybookFile(playbookContent)) {
        console.warn("[Agent 1] Playbook failed validation — missing required sections. Proceeding with research context only.");
        playbookContent = null;
      } else if (playbookContent) {
        // Save playbook permanently
        const playbookDir = join("docs", "playbooks", normalizeNiche(config.niche));
        mkdirSync(playbookDir, { recursive: true });
        const playbookPath = join(playbookDir, `${runId}-playbook.md`);
        writeFileSync(playbookPath, playbookContent, "utf8");
        console.log(`[Agent 1] Playbook saved to ${playbookPath}`);
        eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Playbook saved", detail: playbookPath, timestamp: Date.now() });
      }

      // Build targeted research contexts for each synthesis call
      const keywordResearch = buildResearchContext({
        "keyword-patterns": researchFindings.keywordPatterns,
        "competitor-keywords": researchFindings.competitorKeywords,
      });
      researchContextForTemplates = playbookContent
        ? `PLAYBOOK:\n${playbookContent}\n\nFOCUSED RESEARCH:\n${keywordResearch}`
        : keywordResearch;

      const scoringResearch = buildResearchContext({
        "market-data": researchFindings.marketData,
        "gbp-competition": researchFindings.gbpCompetition,
        "ppc-economics": researchFindings.ppcEconomics,
      });
      researchContextForScoring = playbookContent
        ? `PLAYBOOK:\n${playbookContent}\n\nFOCUSED RESEARCH:\n${scoringResearch}`
        : scoringResearch;

      const clusteringResearch = buildResearchContext({
        "keyword-patterns": researchFindings.keywordPatterns,
        "competitor-keywords": researchFindings.competitorKeywords,
        "local-seo": researchFindings.localSeo,
      });
      researchContextForClustering = playbookContent
        ? `PLAYBOOK:\n${playbookContent}\n\nFOCUSED RESEARCH:\n${clusteringResearch}`
        : clusteringResearch;
      } // end researchFindings !== null
    }

  // Step 1: Load cached templates or generate them once per niche
  console.log("[Agent 1] Step 1: Loading keyword templates...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Loading templates", detail: "Cache lookup", timestamp: Date.now() });
  const templates = await getKeywordTemplates(
    config.niche,
    llm,
    db,
    config.forceRefresh,
    config.offerProfile,
    config.verticalProfile,
    researchContextForTemplates,
    config.runId,
    config.offerId
  );
  console.log(`[Agent 1] Using ${templates.length} keyword templates`);
  for (const [index, template] of templates.slice(0, 8).entries()) {
    console.log(`[Agent 1] Template ${index + 1}/${templates.length}: ${template}`);
  }
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Templates ready", detail: `${templates.length} templates`, timestamp: Date.now() });

  // Step 2: Expand templates per city
  const cityNames = candidateCities.map((c) => c.city);
  const expandedKeywords = expandKeywordTemplates(templates, cityNames);
  console.log(`[Agent 1] Expanded to ${expandedKeywords.length} keywords across ${cityNames.length} cities`);

  // Step 3: Pull metrics from Google Autocomplete + Google Trends
  console.log("[Agent 1] Step 3: Fetching keyword metrics...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Fetching metrics", detail: `${expandedKeywords.length} keywords`, timestamp: Date.now() });
  const kpClient = createGoogleKpClient(db, { forceRefresh: config.forceRefresh });
  const metrics = await kpClient.getKeywordIdeas(expandedKeywords);
  console.log(`[Agent 1] Keyword metrics ready for ${metrics.length} keywords`);
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Metrics ready", detail: `${metrics.length} keywords`, timestamp: Date.now() });

  // Step 4: Score cities via LLM
  console.log("[Agent 1] Step 4: Scoring cities...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Scoring cities", detail: `${candidateCities.length} candidates`, timestamp: Date.now() });
  const scored_cities = await getScoredCities(
    resolvedConfig,
    templates,
    metrics,
    llm,
    db,
    config.forceRefresh,
    researchContextForScoring
  );

  if (config.offerId) {
    console.log(
      `[Agent 1] Applying keyword scores to deployment candidates for ${scored_cities.length} cities...`
    );
    for (const [index, scoredCity] of scored_cities.entries()) {
      const scoreCheckpointKey = `deployment_score:${slugify(scoredCity.city)}:${scoredCity.state.toLowerCase()}`;
      if (checkpoints.has(scoreCheckpointKey)) {
        console.log(
          `[Agent 1] Reusing checkpointed deployment candidate score for ${scoredCity.city}, ${scoredCity.state}`
        );
        continue;
      }
      const payoutBoost = config.payoutPerQualifiedCall
        ? Math.min(10, Math.max(0, config.payoutPerQualifiedCall / 20))
        : 0;
      console.log(
        `[Agent 1] Writing deployment candidate ${index + 1}/${scored_cities.length}: ${scoredCity.city}, ${scoredCity.state}`
      );
      let updateResult;
      try {
        updateResult = await db.query<{ final_score: number | string }>(
          `UPDATE deployment_candidates
           SET keyword_score = $1,
               final_score = ROUND((COALESCE(pre_keyword_score, 0) * 0.45) + ($1 * 0.45) + $2, 2),
               status = $3,
               reasoning = COALESCE(reasoning, '{}'::jsonb) ||
                 jsonb_build_object(
                   'keyword_score', $1,
                   'final_score', ROUND((COALESCE(pre_keyword_score, 0) * 0.45) + ($1 * 0.45) + $2, 2),
                   'keyword_reasoning', $4::text,
                   'payout_boost', $5::numeric
                 ),
               updated_at = now()
           WHERE id IN (
             SELECT id
             FROM deployment_candidates
             WHERE offer_id = $6
               AND city = $7
               AND state = $8
             FOR UPDATE SKIP LOCKED
           )
           RETURNING final_score`,
          [
            scoredCity.priority_score,
            payoutBoost,
            scoredCity.priority_score > 50 ? "researched" : "rejected",
            scoredCity.reasoning ?? "",
            payoutBoost,
            config.offerId,
            scoredCity.city,
            scoredCity.state,
          ]
        );
      } catch (error) {
        console.warn(
          `[Agent 1] Failed to update deployment candidate ${scoredCity.city}, ${scoredCity.state}: ${formatDbErrorDetails(error)}`
        );
        continue;
      }
      const finalScore = Number(updateResult.rows[0]?.final_score ?? Number.NaN);
      if (updateResult.rowCount === 0) {
        console.warn(
          `[Agent 1] Skipped locked or missing deployment candidate: ${scoredCity.city}, ${scoredCity.state}`
        );
        continue;
      }
      console.log(
        `[Agent 1] Updated deployment candidate: ${scoredCity.city}, ${scoredCity.state} -> ${finalScore}`
      );
      await checkpoints.mark(scoreCheckpointKey, {
        city: scoredCity.city,
        state: scoredCity.state,
        finalScore,
      });
    }
    console.log("[Agent 1] Deployment candidate scores updated");
  }

  // Filter to top cities (score > 50)
  const selectedCities = selectTopCities(scored_cities);

  console.log(`[Agent 1] Selected ${selectedCities.length} cities`);
  for (const [index, city] of selectedCities.entries()) {
    console.log(
      `[Agent 1] Selected city ${index + 1}/${selectedCities.length}: ${city.city}, ${city.state} (${city.priority_score})`
    );
  }
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Cities selected", detail: `${selectedCities.length} cities`, timestamp: Date.now() });

  // Step 5: Cluster keywords per city
  for (const city of selectedCities) {
    const cityCheckpointKey = `city_clusters:${slugify(city.city)}:${city.state.toLowerCase()}`;
    if (checkpoints.has(cityCheckpointKey)) {
      console.log(`[Agent 1] Reusing checkpointed keyword clusters for ${city.city}, ${city.state}`);
      continue;
    }
    console.log(`[Agent 1] Checking whether ${city.city}, ${city.state} can reuse cached research...`);
    if (await getCachedCityResearch(config, city, templates, db)) {
      await checkpoints.mark(cityCheckpointKey, {
        city: city.city,
        state: city.state,
        source: "cache",
      });
      continue;
    }

    console.log(`[Agent 1] Step 5: Clustering keywords for ${city.city}...`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Clustering", detail: city.city, timestamp: Date.now() });
    const cityKeywords = expandedKeywords.filter((kw) =>
      kw.toLowerCase().includes(city.city.toLowerCase())
    );

    const strategy = resolveVerticalStrategy(
      config.verticalProfile?.vertical_key ?? config.offerProfile?.vertical
    );
    const clusterPrompt = strategy.getKeywordClusteringPrompt(
      {
        city: city.city,
        state: city.state,
        keywordsJson: JSON.stringify(cityKeywords),
      },
      {
        offerProfile: config.offerProfile,
        verticalProfile: config.verticalProfile,
      }
    );

    const { clusters, url_mapping } = await withSelfHealing({
      runId: config.runId ?? "no-run-id",
      offerId: config.offerId ?? "unknown",
      agentName: "agent-1",
      step: "keyword_cluster",
      city: city.city,
      state: city.state,
      fn: async () => {
        const clusterResponse = await llm.call({
          prompt: withResearchContext(clusterPrompt, researchContextForClustering),
          schema: KeywordClusteringResponseSchema,
          model: "haiku",
          logLabel: `[Agent 1][Step 5][${city.city} clustering]`,
        });
        const parsedClusters = clusterResponse.clusters.map((c) =>
          KeywordClusterSchema.parse({
            cluster_name: c.cluster_name,
            primary_keyword: c.primary_keyword,
            secondary_keywords: c.secondary_keywords,
            search_volume: c.search_volume,
            difficulty: c.difficulty,
            intent: IntentSchema.safeParse(c.intent.toLowerCase()).success
              ? c.intent.toLowerCase()
              : "transactional",
          })
        );
        const serviceClusters = parsedClusters.filter((cluster, index) =>
          index === 0 ||
          isServiceAllowed(
            `${cluster.cluster_name} ${cluster.primary_keyword}`,
            config.offerProfile,
            config.verticalProfile
          )
        );
        const clusters = serviceClusters.length > 0 ? serviceClusters : parsedClusters;
        const citySlug = slugify(city.city);
        const url_mapping = buildUrlMapping(clusters, citySlug);
        return { clusters, url_mapping };
      },
      getRepairContext: (err) => `
Keyword clustering for ${city.city}, ${city.state} failed with this error:
${err.message}

The clustering prompt was:
${clusterPrompt}

Fix the response so it matches the KeywordClusteringResponseSchema:
{ clusters: Array<{ cluster_name: string, primary_keyword: string, secondary_keywords: string[], search_volume: number, difficulty: number, intent: string }> }

Return JSON with two fields:
- "fixed_code": a valid JSON string matching the schema above
- "summary": one sentence describing what was wrong
`,
      applyFix: async (fixedCode) => {
        console.log(`[Agent 1][SelfHealing] Fix for ${city.city} clustering: ${fixedCode.slice(0, 100)}...`);
      },
      db,
      llm,
    });
    const researchFingerprint = getCityResearchFingerprint(
      config.niche,
      city.city,
      city.state,
      templates
    );
    console.log(
      `[Agent 1] Cluster plan for ${city.city}: ${clusters
        .slice(0, 5)
        .map((cluster) => cluster.cluster_name)
        .join(" | ")}`
    );

    // Step 6: Write to DB
    console.log(`[Agent 1] Loading existing keyword cluster map for ${city.city}, ${city.state}...`);
    const existingMapResult = await db.query<{ keyword_cluster_ids: string[] }>(
      `SELECT keyword_cluster_ids
       FROM city_keyword_map
       WHERE city = $1
         AND state = $2
         AND niche = $3
       LIMIT 1`,
      [city.city, city.state, normalizeNiche(config.niche)]
    );
    const previousClusterIds = Array.isArray(existingMapResult.rows[0]?.keyword_cluster_ids)
      ? existingMapResult.rows[0].keyword_cluster_ids
      : [];
    const clusterIds: string[] = [];
    for (const [clusterIndex, cluster] of clusters.entries()) {
      console.log(
        `[Agent 1] Upserting cluster ${clusterIndex + 1}/${clusters.length} for ${city.city}: ${cluster.primary_keyword}`
      );
      const result = await db.query(
        `INSERT INTO keyword_clusters
         (cluster_name, primary_keyword, secondary_keywords, search_volume, difficulty, intent, city, state, niche)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (city, state, niche, primary_keyword) DO UPDATE SET
           cluster_name = EXCLUDED.cluster_name,
           secondary_keywords = EXCLUDED.secondary_keywords,
           search_volume = EXCLUDED.search_volume,
           difficulty = EXCLUDED.difficulty,
           intent = EXCLUDED.intent
         RETURNING id`,
        [
          cluster.cluster_name,
          cluster.primary_keyword,
          cluster.secondary_keywords,
          cluster.search_volume,
          cluster.difficulty,
          cluster.intent,
          city.city,
          city.state,
          normalizeNiche(config.niche),
        ]
      );
      clusterIds.push(result.rows[0].id);
    }

    console.log(`[Agent 1] Saving city keyword map for ${city.city}, ${city.state}...`);
    await db.query(
      `INSERT INTO city_keyword_map
       (city, state, population, priority_score, keyword_cluster_ids, url_mapping, niche, research_fingerprint, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (city, state, niche) DO UPDATE SET
         population = EXCLUDED.population,
         priority_score = EXCLUDED.priority_score,
         keyword_cluster_ids = EXCLUDED.keyword_cluster_ids,
         url_mapping = EXCLUDED.url_mapping,
         research_fingerprint = EXCLUDED.research_fingerprint,
         updated_at = now()`,
      [
        city.city,
        city.state,
        city.population,
        city.priority_score,
        clusterIds,
        JSON.stringify(url_mapping),
        normalizeNiche(config.niche),
        researchFingerprint,
      ]
    );
    console.log(`[Agent 1] City keyword map saved for ${city.city}, ${city.state}`);

    const staleClusterIds = previousClusterIds.filter(
      (clusterId) => !clusterIds.includes(clusterId)
    );
    if (staleClusterIds.length > 0) {
      console.log(
        `[Agent 1] Deleting ${staleClusterIds.length} stale keyword clusters for ${city.city}, ${city.state}...`
      );
      await db.query(
        "DELETE FROM keyword_clusters WHERE id = ANY($1::uuid[])",
        [staleClusterIds]
      );
      console.log(`[Agent 1] Deleted stale keyword clusters for ${city.city}, ${city.state}`);
    }

    console.log(`[Agent 1] Saved ${clusters.length} clusters for ${city.city}`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Clusters saved", detail: `${clusters.length} for ${city.city}`, timestamp: Date.now() });
    await checkpoints.mark(cityCheckpointKey, {
      city: city.city,
      state: city.state,
      clusterCount: clusters.length,
    });
  }

    await checkpoints.mark("completed", {
      selectedCities: selectedCities.length,
    });
    console.log("[Agent 1] Keyword research complete");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    eventBus.emitEvent({
      type: "agent_error",
      agent: "agent-1",
      error: reason,
      timestamp: Date.now(),
    });
    throw error;
  } finally {
    if (researchDirToCleanup && config.cleanupResearchDir !== false) {
      try {
        rmSync(researchDirToCleanup, { recursive: true, force: true });
        console.log(`[Agent 1] Cleaned up research temp directory: ${researchDirToCleanup}`);
      } catch (error) {
        console.warn(`[Agent 1] Failed to clean up research temp directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

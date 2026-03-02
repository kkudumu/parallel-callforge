import { z } from "zod/v4";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import type { CitySourceMode } from "../../config/env.js";
import { KeywordClusterSchema } from "../../shared/schemas/keyword-clusters.js";
import { createGoogleKpClient } from "./google-kp.js";
import { eventBus } from "../../shared/events/event-bus.js";
import {
  getCityResearchFingerprint,
  getCityScoringFingerprint,
  isFreshTimestamp,
  KEYWORD_RESEARCH_TTL_MS,
  normalizeNiche,
  selectTopCities,
  type ScoredCity,
} from "../../shared/cache-policy.js";
import {
  KEYWORD_TEMPLATE_PROMPT,
  CITY_SCORING_PROMPT,
  KEYWORD_CLUSTERING_PROMPT,
} from "./prompts.js";

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

const AGENT_1_TARGET_POPULATION_MIN = 50_000;
const AGENT_1_TARGET_POPULATION_MAX = 300_000;

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

function truncateReasoning(reasoning: string, maxLength = 140): string {
  const trimmed = reasoning.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3)}...`;
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
  topCandidateLimit?: number;
  citySource?: CitySourceMode;
  payoutPerQualifiedCall?: number;
  forceRefresh?: boolean;
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
     LIMIT $4`,
    [
      offerId,
      AGENT_1_TARGET_POPULATION_MIN,
      AGENT_1_TARGET_POPULATION_MAX,
      Math.max(1, topCandidateLimit),
    ]
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
  forceRefresh = false
): Promise<string[]> {
  const cacheKey = normalizeNiche(niche);
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
  if (!forceRefresh && Array.isArray(cachedTemplates) && cachedTemplates.length > 0 && isFresh) {
    console.log(`[Agent 1] Reusing ${cachedTemplates.length} cached keyword templates`);
    return cachedTemplates;
  }

  console.log("[Agent 1] Keyword templates missing or stale, refreshing...");
  const templatePrompt = KEYWORD_TEMPLATE_PROMPT.replace("{niche}", niche);
  const { templates } = await llm.call({
    prompt: templatePrompt,
    schema: KeywordTemplatesResponseSchema,
    model: "haiku",
    logLabel: "[Agent 1][Step 1][Keyword templates]",
  });

  await db.query(
    `INSERT INTO keyword_templates
     (niche, templates, cache_provider, cache_version, retrieval_method, confidence_score, updated_at)
     VALUES ($1, $2, 'llm', 'v1', 'generated', 0.65, now())
     ON CONFLICT (niche)
     DO UPDATE SET
       templates = EXCLUDED.templates,
       cache_provider = EXCLUDED.cache_provider,
       cache_version = EXCLUDED.cache_version,
       retrieval_method = EXCLUDED.retrieval_method,
       confidence_score = EXCLUDED.confidence_score,
       updated_at = now()`,
    [cacheKey, templates]
  );

  return templates;
}

async function getScoredCities(
  config: Agent1Config,
  templates: string[],
  metrics: unknown[],
  llm: LlmClient,
  db: DbClient,
  forceRefresh = false
): Promise<ScoredCity[]> {
  const candidateCities = config.candidateCities ?? [];
  const cacheKey = normalizeNiche(config.niche);
  const inputFingerprint = getCityScoringFingerprint(candidateCities, templates);
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
  const scoringPrompt = CITY_SCORING_PROMPT
    .replace("{city_data}", JSON.stringify(candidateCities, null, 2))
    .replace("{keyword_data}", JSON.stringify(metrics.slice(0, 100), null, 2));

  const scoringLogger = createStreamingLogger("[Agent 1][city-scoring]");
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    console.log(
      `[Agent 1] City scoring still running... ${elapsedSeconds}s elapsed for ${candidateCities.length} candidates`
    );
  }, 5000);

  let scored_cities: ScoredCity[] = [];
  try {
    ({ scored_cities } = await llm.call({
      prompt: scoringPrompt,
      schema: CityScoringResponseSchema,
      model: "haiku",
      onOutput: (chunk, stream) => scoringLogger.onOutput(chunk, stream),
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
      `[Agent 1] Scored city ${index + 1}/${scored_cities.length}: ${city.city}, ${city.state} -> ${city.priority_score}/100 (${truncateReasoning(city.reasoning ?? "No reasoning provided")})`
    );
  }

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
    return false;
  }

  const isFresh =
    row.research_fingerprint === researchFingerprint &&
    isFreshTimestamp(row.updated_at, KEYWORD_RESEARCH_TTL_MS);
  if (!isFresh) {
    return false;
  }

  const clusterIds = Array.isArray(row.keyword_cluster_ids) ? row.keyword_cluster_ids : [];
  if (clusterIds.length === 0) {
    return false;
  }

  const clusters = await db.query<{ id: string }>(
    "SELECT id FROM keyword_clusters WHERE id = ANY($1::uuid[])",
    [clusterIds]
  );

  if (clusters.rows.length !== clusterIds.length) {
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

  console.log(`[Agent 1] Starting keyword research for ${config.niche}`);
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Starting", detail: config.niche, timestamp: Date.now() });
  if (config.forceRefresh) {
    console.log("[Agent 1] Force refresh enabled, bypassing keyword research caches");
  }

  // Step 1: Load cached templates or generate them once per niche
  console.log("[Agent 1] Step 1: Loading keyword templates...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Loading templates", detail: "Cache lookup", timestamp: Date.now() });
  const templates = await getKeywordTemplates(config.niche, llm, db, config.forceRefresh);
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
  const kpClient = createGoogleKpClient(db, { forceRefresh: config.forceRefresh });
  const metrics = await kpClient.getKeywordIdeas(expandedKeywords);

  // Step 4: Score cities via LLM
  console.log("[Agent 1] Step 4: Scoring cities...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Scoring cities", detail: `${candidateCities.length} candidates`, timestamp: Date.now() });
  const scored_cities = await getScoredCities(
    resolvedConfig,
    templates,
    metrics,
    llm,
    db,
    config.forceRefresh
  );

  if (config.offerId) {
    for (const scoredCity of scored_cities) {
      const existing = await db.query<{ pre_keyword_score: number | string }>(
        `SELECT pre_keyword_score
         FROM deployment_candidates
         WHERE offer_id = $1
           AND city = $2
           AND state = $3
         LIMIT 1`,
        [config.offerId, scoredCity.city, scoredCity.state]
      );

      const preKeywordScore = Number(existing.rows[0]?.pre_keyword_score ?? 0);
      const payoutBoost = config.payoutPerQualifiedCall
        ? Math.min(10, Math.max(0, config.payoutPerQualifiedCall / 20))
        : 0;
      const finalScore = Math.round((
        (preKeywordScore * 0.45) +
        (scoredCity.priority_score * 0.45) +
        payoutBoost
      ) * 100) / 100;
      await db.query(
        `UPDATE deployment_candidates
         SET keyword_score = $1,
             final_score = $2,
             status = $3,
             reasoning = COALESCE(reasoning, '{}'::jsonb) ||
               jsonb_build_object(
                 'keyword_score', $1,
                 'final_score', $2,
                 'keyword_reasoning', $4,
                 'payout_boost', $5
               ),
             updated_at = now()
         WHERE offer_id = $6
           AND city = $7
           AND state = $8`,
        [
          scoredCity.priority_score,
          finalScore,
          scoredCity.priority_score > 50 ? "researched" : "rejected",
          scoredCity.reasoning ?? "",
          payoutBoost,
          config.offerId,
          scoredCity.city,
          scoredCity.state,
        ]
      );
    }
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
    if (await getCachedCityResearch(config, city, templates, db)) {
      continue;
    }

    console.log(`[Agent 1] Step 5: Clustering keywords for ${city.city}...`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Clustering", detail: city.city, timestamp: Date.now() });
    const cityKeywords = expandedKeywords.filter((kw) =>
      kw.toLowerCase().includes(city.city.toLowerCase())
    );

    const clusterPrompt = KEYWORD_CLUSTERING_PROMPT
      .replace("{city}", city.city)
      .replace("{state}", city.state)
      .replace("{keywords}", JSON.stringify(cityKeywords));

    const clusterResponse = await llm.call({
      prompt: clusterPrompt,
      schema: KeywordClusteringResponseSchema,
      model: "haiku",
      logLabel: `[Agent 1][Step 5][${city.city} clustering]`,
    });
    const clusters = clusterResponse.clusters.map((c) =>
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
    const citySlug = slugify(city.city);
    const url_mapping = buildUrlMapping(clusters, citySlug);
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
    for (const cluster of clusters) {
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

    const staleClusterIds = previousClusterIds.filter(
      (clusterId) => !clusterIds.includes(clusterId)
    );
    if (staleClusterIds.length > 0) {
      await db.query(
        "DELETE FROM keyword_clusters WHERE id = ANY($1::uuid[])",
        [staleClusterIds]
      );
    }

    console.log(`[Agent 1] Saved ${clusters.length} clusters for ${city.city}`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Clusters saved", detail: `${clusters.length} for ${city.city}`, timestamp: Date.now() });
  }

  console.log("[Agent 1] Keyword research complete");
}

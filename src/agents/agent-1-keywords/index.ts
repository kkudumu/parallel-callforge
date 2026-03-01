import { z } from "zod/v4";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { KeywordClusterSchema } from "../../shared/schemas/keyword-clusters.js";
import { createGoogleKpClient } from "./google-kp.js";
import { eventBus } from "../../shared/events/event-bus.js";
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

export interface Agent1Config {
  niche: string;
  candidateCities: Array<{ city: string; state: string; population: number }>;
}

function getTemplateCacheKey(niche: string): string {
  return niche.trim().toLowerCase();
}

export async function getKeywordTemplates(
  niche: string,
  llm: LlmClient,
  db: DbClient
): Promise<string[]> {
  const cacheKey = getTemplateCacheKey(niche);
  const cached = await db.query<{ templates: string[] }>(
    `SELECT templates
     FROM keyword_templates
     WHERE niche = $1
     LIMIT 1`,
    [cacheKey]
  );

  const cachedTemplates = cached.rows[0]?.templates;
  if (Array.isArray(cachedTemplates) && cachedTemplates.length > 0) {
    console.log(`[Agent 1] Reusing ${cachedTemplates.length} cached keyword templates`);
    return cachedTemplates;
  }

  console.log("[Agent 1] No cached keyword templates found, generating...");
  const templatePrompt = KEYWORD_TEMPLATE_PROMPT.replace("{niche}", niche);
  const { templates } = await llm.call({
    prompt: templatePrompt,
    schema: KeywordTemplatesResponseSchema,
    model: "haiku",
  });

  await db.query(
    `INSERT INTO keyword_templates (niche, templates, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (niche)
     DO UPDATE SET
       templates = EXCLUDED.templates,
       updated_at = now()`,
    [cacheKey, templates]
  );

  return templates;
}

export async function runAgent1(
  config: Agent1Config,
  llm: LlmClient,
  db: DbClient
): Promise<void> {
  console.log(`[Agent 1] Starting keyword research for ${config.niche}`);
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Starting", detail: config.niche, timestamp: Date.now() });

  // Step 1: Load cached templates or generate them once per niche
  console.log("[Agent 1] Step 1: Loading keyword templates...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Loading templates", detail: "Cache lookup", timestamp: Date.now() });
  const templates = await getKeywordTemplates(config.niche, llm, db);
  console.log(`[Agent 1] Using ${templates.length} keyword templates`);
  for (const [index, template] of templates.slice(0, 8).entries()) {
    console.log(`[Agent 1] Template ${index + 1}/${templates.length}: ${template}`);
  }
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Templates ready", detail: `${templates.length} templates`, timestamp: Date.now() });

  // Step 2: Expand templates per city
  const cityNames = config.candidateCities.map((c) => c.city);
  const expandedKeywords = expandKeywordTemplates(templates, cityNames);
  console.log(`[Agent 1] Expanded to ${expandedKeywords.length} keywords across ${cityNames.length} cities`);

  // Step 3: Pull metrics from Google Autocomplete + Google Trends
  const kpClient = createGoogleKpClient();
  const metrics = await kpClient.getKeywordIdeas(expandedKeywords);

  // Step 4: Score cities via LLM
  console.log("[Agent 1] Step 4: Scoring cities...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Scoring cities", detail: `${config.candidateCities.length} candidates`, timestamp: Date.now() });
  const scoringPrompt = CITY_SCORING_PROMPT
    .replace("{city_data}", JSON.stringify(config.candidateCities, null, 2))
    .replace("{keyword_data}", JSON.stringify(metrics.slice(0, 100), null, 2));

  const { scored_cities } = await llm.call({
    prompt: scoringPrompt,
    schema: CityScoringResponseSchema,
    model: "haiku",
  });

  // Filter to top cities (score > 50)
  const selectedCities = scored_cities
    .filter((c) => c.priority_score > 50)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 5);

  console.log(`[Agent 1] Selected ${selectedCities.length} cities`);
  for (const [index, city] of selectedCities.entries()) {
    console.log(
      `[Agent 1] Selected city ${index + 1}/${selectedCities.length}: ${city.city}, ${city.state} (${city.priority_score})`
    );
  }
  eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Cities selected", detail: `${selectedCities.length} cities`, timestamp: Date.now() });

  // Step 5: Cluster keywords per city
  for (const city of selectedCities) {
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
    console.log(
      `[Agent 1] Cluster plan for ${city.city}: ${clusters
        .slice(0, 5)
        .map((cluster) => cluster.cluster_name)
        .join(" | ")}`
    );

    // Step 6: Write to DB
    const clusterIds: string[] = [];
    for (const cluster of clusters) {
      const result = await db.query(
        `INSERT INTO keyword_clusters
         (cluster_name, primary_keyword, secondary_keywords, search_volume, difficulty, intent, city, state, niche)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          cluster.cluster_name,
          cluster.primary_keyword,
          cluster.secondary_keywords,
          cluster.search_volume,
          cluster.difficulty,
          cluster.intent,
          city.city,
          city.state,
          config.niche,
        ]
      );
      clusterIds.push(result.rows[0].id);
    }

    await db.query(
      `INSERT INTO city_keyword_map
       (city, state, population, priority_score, keyword_cluster_ids, url_mapping, niche)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        city.city,
        city.state,
        city.population,
        city.priority_score,
        clusterIds,
        JSON.stringify(url_mapping),
        config.niche,
      ]
    );

    console.log(`[Agent 1] Saved ${clusters.length} clusters for ${city.city}`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-1", step: "Clusters saved", detail: `${clusters.length} for ${city.city}`, timestamp: Date.now() });
  }

  console.log("[Agent 1] Keyword research complete");
}

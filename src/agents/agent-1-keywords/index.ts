import { z } from "zod/v4";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { KeywordClusterSchema } from "../../shared/schemas/keyword-clusters.js";
import { createGoogleKpClient } from "./google-kp.js";
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

// Schema for LLM keyword clustering
const KeywordClusteringResponseSchema = z.object({
  clusters: z.array(KeywordClusterSchema),
  url_mapping: z.record(z.string(), z.string()),
});

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

export async function runAgent1(
  config: Agent1Config,
  llm: LlmClient,
  db: DbClient
): Promise<void> {
  console.log(`[Agent 1] Starting keyword research for ${config.niche}`);

  // Step 1: Generate keyword templates via LLM
  console.log("[Agent 1] Step 1: Generating keyword templates...");
  const templatePrompt = KEYWORD_TEMPLATE_PROMPT.replace("{niche}", config.niche);
  const { templates } = await llm.call({
    prompt: templatePrompt,
    schema: KeywordTemplatesResponseSchema,
  });
  console.log(`[Agent 1] Generated ${templates.length} keyword templates`);

  // Step 2: Expand templates per city
  const cityNames = config.candidateCities.map((c) => c.city);
  const expandedKeywords = expandKeywordTemplates(templates, cityNames);
  console.log(`[Agent 1] Expanded to ${expandedKeywords.length} keywords across ${cityNames.length} cities`);

  // Step 3: Pull metrics from Google KP (stub for now)
  const kpClient = createGoogleKpClient();
  const metrics = await kpClient.getKeywordIdeas(expandedKeywords);

  // Step 4: Score cities via LLM
  console.log("[Agent 1] Step 4: Scoring cities...");
  const scoringPrompt = CITY_SCORING_PROMPT
    .replace("{city_data}", JSON.stringify(config.candidateCities, null, 2))
    .replace("{keyword_data}", JSON.stringify(metrics.slice(0, 100), null, 2));

  const { scored_cities } = await llm.call({
    prompt: scoringPrompt,
    schema: CityScoringResponseSchema,
  });

  // Filter to top cities (score > 50)
  const selectedCities = scored_cities
    .filter((c) => c.priority_score > 50)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 5);

  console.log(`[Agent 1] Selected ${selectedCities.length} cities`);

  // Step 5: Cluster keywords per city
  for (const city of selectedCities) {
    console.log(`[Agent 1] Step 5: Clustering keywords for ${city.city}...`);
    const cityKeywords = expandedKeywords.filter((kw) =>
      kw.toLowerCase().includes(city.city.toLowerCase())
    );

    const clusterPrompt = KEYWORD_CLUSTERING_PROMPT
      .replace("{city}", city.city)
      .replace("{state}", city.state)
      .replace("{keywords}", JSON.stringify(cityKeywords));

    const { clusters, url_mapping } = await llm.call({
      prompt: clusterPrompt,
      schema: KeywordClusteringResponseSchema,
    });

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
  }

  console.log("[Agent 1] Keyword research complete");
}

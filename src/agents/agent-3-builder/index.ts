import { z } from "zod/v4";
import path from "node:path";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { createHugoManager } from "./hugo-manager.js";
import { runQualityGate } from "./quality-gate.js";
import { slugify } from "../agent-1-keywords/index.js";
import { CITY_HUB_PROMPT, SERVICE_SUBPAGE_PROMPT } from "./prompts.js";

const ContentResponseSchema = z.object({
  title: z.string(),
  meta_description: z.string(),
  content: z.string().min(100),
  headings: z.array(z.string()).optional(),
  faq: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })).optional(),
});

export interface Agent3Config {
  niche: string;
  hugoSitePath: string;
  phone: string;
  minWordCountHub: number;
  minWordCountSubpage: number;
}

const DEFAULT_CONFIG: Partial<Agent3Config> = {
  phone: "(555) 123-4567",
  minWordCountHub: 800,
  minWordCountSubpage: 1200,
};

export async function runAgent3(
  config: Agent3Config,
  llm: LlmClient,
  db: DbClient
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const hugo = createHugoManager(cfg.hugoSitePath);
  hugo.ensureProject();

  console.log(`[Agent 3] Starting site build for ${cfg.niche}`);

  // Get cities from city_keyword_map
  const citiesResult = await db.query(
    "SELECT city, state, url_mapping, keyword_cluster_ids FROM city_keyword_map WHERE niche = $1",
    [cfg.niche]
  );

  if (citiesResult.rows.length === 0) {
    console.log("[Agent 3] No cities found in keyword map. Run Agent 1 first.");
    return;
  }

  for (const cityRow of citiesResult.rows) {
    const { city, state } = cityRow;
    const citySlug = slugify(city);
    console.log(`[Agent 3] Building pages for ${city}, ${state}`);

    // Get keyword clusters for this city
    const clustersResult = await db.query(
      "SELECT * FROM keyword_clusters WHERE city = $1 AND niche = $2",
      [city, cfg.niche]
    );

    // Generate city hub page
    const hubKeyword = clustersResult.rows.find(
      (c: any) => c.intent === "transactional"
    )?.primary_keyword ?? `${city} ${cfg.niche}`;

    console.log(`[Agent 3] Generating hub page for ${city}...`);
    const hubPrompt = CITY_HUB_PROMPT
      .replace(/\{city\}/g, city)
      .replace(/\{state\}/g, state)
      .replace(/\{keyword\}/g, hubKeyword)
      .replace(/\{phone\}/g, cfg.phone!);

    const hubContent = await llm.call({
      prompt: hubPrompt,
      schema: ContentResponseSchema,
    });

    // Quality gate
    const hubQuality = runQualityGate(hubContent.content, city, cfg.minWordCountHub!);
    if (!hubQuality.passed) {
      console.warn(`[Agent 3] Hub page quality gate failed for ${city}: ${hubQuality.failures.join(", ")}`);
    }

    // Write hub page
    const hubSlug = `${citySlug}/_index.md`;
    hugo.writeContentFile(hubSlug, {
      title: hubContent.title,
      description: hubContent.meta_description,
      city: city,
      state: state,
      type: "city_hub",
      target_keyword: hubKeyword,
      draft: false,
    }, hubContent.content);

    // Record in DB
    await db.query(
      `INSERT INTO content_items (title, slug, content_type, target_keyword, city, niche, word_count, quality_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET word_count = $7, quality_score = $8`,
      [
        hubContent.title,
        `${citySlug}`,
        "city_hub",
        hubKeyword,
        city,
        cfg.niche,
        hubQuality.metrics.wordCount,
        JSON.stringify(hubQuality.metrics),
      ]
    );

    // Generate service subpages for pest-specific clusters
    const serviceClusterTypes = clustersResult.rows.filter(
      (c: any) => c.cluster_name !== hubKeyword && c.intent !== "navigational"
    );

    for (const cluster of serviceClusterTypes.slice(0, 5)) {
      const pestType = cluster.cluster_name;
      const pestSlug = slugify(pestType);
      console.log(`[Agent 3] Generating subpage: ${city}/${pestType}...`);

      const subPrompt = SERVICE_SUBPAGE_PROMPT
        .replace(/\{city\}/g, city)
        .replace(/\{state\}/g, state)
        .replace(/\{pest_type\}/g, pestType)
        .replace(/\{keyword\}/g, cluster.primary_keyword)
        .replace(/\{phone\}/g, cfg.phone!);

      const subContent = await llm.call({
        prompt: subPrompt,
        schema: ContentResponseSchema,
      });

      const subQuality = runQualityGate(subContent.content, city, cfg.minWordCountSubpage!);
      if (!subQuality.passed) {
        console.warn(`[Agent 3] Subpage quality gate failed for ${city}/${pestType}: ${subQuality.failures.join(", ")}`);
      }

      hugo.writeContentFile(`${citySlug}/${pestSlug}.md`, {
        title: subContent.title,
        description: subContent.meta_description,
        city: city,
        state: state,
        pest_type: pestType,
        type: "service_subpage",
        target_keyword: cluster.primary_keyword,
        draft: false,
      }, subContent.content);

      await db.query(
        `INSERT INTO content_items (title, slug, content_type, target_keyword, pest_type, city, niche, word_count, quality_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (slug) DO UPDATE SET word_count = $8, quality_score = $9`,
        [
          subContent.title,
          `${citySlug}/${pestSlug}`,
          "service_subpage",
          cluster.primary_keyword,
          pestType,
          city,
          cfg.niche,
          subQuality.metrics.wordCount,
          JSON.stringify(subQuality.metrics),
        ]
      );
    }

    // Register pages
    const pageUrl = `https://extermanation.com/${citySlug}/`;
    await db.query(
      `INSERT INTO pages (url, slug, city, state, niche, target_keyword, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (slug) DO NOTHING`,
      [pageUrl, citySlug, city, state, cfg.niche, hubKeyword]
    );
  }

  // Build Hugo site
  console.log("[Agent 3] Building Hugo site...");
  const buildResult = await hugo.buildSite();
  if (buildResult.success) {
    console.log("[Agent 3] Hugo build successful");
  } else {
    console.warn(`[Agent 3] Hugo build failed: ${buildResult.output}`);
  }

  console.log("[Agent 3] Site build complete");
}

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod/v4";
import { createDbClient, type DbClient } from "../shared/db/client.js";
import { runAgent1, type Agent1Config } from "../agents/agent-1-keywords/index.js";
import { runAgent3, type Agent3Config } from "../agents/agent-3-builder/index.js";
import { evaluateThresholds } from "../agents/agent-7-monitor/thresholds.js";
import { calculateHealthScore, interpretScore } from "../agents/agent-7-monitor/health-score.js";
import type { LlmClient, LlmCallOptions } from "../shared/cli/llm-client.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? "postgres://callforge:callforge@localhost:5434/callforge";

let db: DbClient;
let tmpHugoDir: string;

// Mock LLM client that returns appropriate responses based on prompt content
function createMockLlmClient(): LlmClient {
  let callCount = 0;

  return {
    async call<T extends z.ZodType>(options: LlmCallOptions<T>): Promise<z.infer<T>> {
      callCount++;
      const prompt = options.prompt.toLowerCase();

      // Agent 1: keyword template generation
      if (prompt.includes("keyword template") || prompt.includes("generate keyword")) {
        return {
          templates: [
            "{city} pest control",
            "{city} exterminator",
            "{city} termite control",
            "{city} ant control",
            "{city} rodent control",
            "pest control near {city}",
            "best exterminator in {city}",
            "termite inspection {city}",
            "ant removal {city}",
            "rodent removal {city}",
          ],
        } as z.infer<T>;
      }

      // Agent 1: city scoring
      if (prompt.includes("score") || prompt.includes("priorit")) {
        return {
          scored_cities: [
            {
              city: "Santa Cruz",
              state: "CA",
              population: 65000,
              priority_score: 85,
              reasoning: "High pest activity region with good population density",
            },
          ],
        } as z.infer<T>;
      }

      // Agent 3: content generation (hub or subpage)
      if (
        prompt.includes("local seo content writer for pest control businesses") ||
        prompt.includes("expert pest control content writer") ||
        prompt.includes("target keyword:")
      ) {
        const words = Array(900).fill("quality").join(" ");
        return {
          title: "Santa Cruz Pest Control Services",
          meta_description: "Professional pest control in Santa Cruz, CA. Same-day service available.",
          content: `Professional pest control services in Santa Cruz. ${words} Call us for Santa Cruz pest control today.`,
          headings: ["Why Choose Us", "Our Services", "Service Area"],
        } as z.infer<T>;
      }

      // Agent 1: keyword clustering
      if (
        prompt.includes("url structure optimization") ||
        prompt.includes("group them into clusters") ||
        prompt.includes("map each cluster to a url path")
      ) {
        return {
          clusters: [
            {
              cluster_name: "pest control",
              primary_keyword: "Santa Cruz pest control",
              secondary_keywords: ["pest control Santa Cruz", "exterminator Santa Cruz"],
              search_volume: 320,
              difficulty: 35,
              intent: "transactional",
            },
            {
              cluster_name: "termite control",
              primary_keyword: "Santa Cruz termite control",
              secondary_keywords: ["termite inspection Santa Cruz"],
              search_volume: 150,
              difficulty: 30,
              intent: "transactional",
            },
          ],
          url_mapping: {
            "/santa-cruz/": "Santa Cruz pest control",
            "/santa-cruz/termite-control/": "Santa Cruz termite control",
          },
        } as z.infer<T>;
      }

      // Agent 2: competitor analysis
      if (prompt.includes("produce a competitor analysis") || prompt.includes("analyze the top-performing landing page patterns")) {
        return {
          patterns: [
            {
              category: "hero",
              findings: ["Strong urgency", "Visible phone number"],
              recommendation: "Lead with emergency availability",
            },
          ],
          top_cta_patterns: ["Call now", "Get same-day service"],
          trust_signal_types: ["licensed", "insured"],
          layout_order: ["hero", "trust", "services", "faq", "cta"],
        } as z.infer<T>;
      }

      // Agent 2: design specification
      if (prompt.includes("ui/ux designer")) {
        return {
          niche: "pest-control",
          archetype: "emergency",
          layout: { sections: ["hero", "trust", "services", "faq", "cta"] },
          components: [{ name: "hero", type: "split" }, { name: "trust ribbon", type: "band" }, { name: "service cards", type: "grid" }],
          colors: { primary: "#FF6B00", secondary: "#1A1A2E", tertiary: "#F4EFE6", highlight: "#2A9D8F" },
          typography: { heading: "Inter", body: "Open Sans" },
          responsive_breakpoints: { mobile: 375, tablet: 768, desktop: 1200 },
        } as z.infer<T>;
      }

      // Agent 2: copy framework
      if (prompt.includes("direct-response copywriter")) {
        return {
          niche: "pest-control",
          headlines: ["Stop infestations before they spread", "Fast local pest control with clear next steps"],
          ctas: ["Request Same-Day Service", "Book a Free Inspection"],
          trust_signals: ["Licensed local technicians", "Same-day appointments", "Straightforward treatment plans"],
          faq_templates: [
            {
              question: "How does your first inspection work?",
              answer_template: "We inspect the property, identify pest pressure, and explain the treatment plan before service starts.",
            },
          ],
          pas_scripts: [
            {
              problem: "Active infestation",
              agitate: "Pests spread quickly through hidden access points",
              solve: "Targeted treatment and exclusion plan",
            },
          ],
        } as z.infer<T>;
      }

      // Agent 2: schema templates
      if (prompt.includes("structured data specialist")) {
        return {
          niche: "pest-control",
          jsonld_templates: {
            city_hub: {
              "@context": "https://schema.org",
              "@type": "PestControlService",
            },
            service_subpage: {
              "@context": "https://schema.org",
              "@type": "Service",
            },
          },
        } as z.infer<T>;
      }

      // Agent 2: seasonal calendar
      if (prompt.includes("12-month seasonal content calendar") || prompt.includes("pest control industry analyst")) {
        return {
          niche: "pest-control",
          months: [
            {
              month: 3,
              name: "March",
              primary_pests: ["termites", "ants"],
              content_topics: ["spring swarms", "foundation entry points"],
              messaging_priority: "prevent spring infestation growth",
              seasonal_keywords: ["termite inspection", "ant control"],
            },
          ],
        } as z.infer<T>;
      }

      // Fallback
      return {
        title: "Test Content",
        meta_description: "Test description",
        content: "Test content for Santa Cruz with sufficient length. " + Array(200).fill("word").join(" "),
      } as z.infer<T>;
    },
  };
}

describe("Integration: Pipeline", () => {
  beforeAll(async () => {
    // Create temp Hugo directory
    tmpHugoDir = fs.mkdtempSync(path.join(os.tmpdir(), "callforge-hugo-"));

    // Connect to test DB
    db = createDbClient(TEST_DB_URL);

    // Run migrations
    const migrationsDir = path.resolve("src/shared/db/migrations");
    await db.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = await db.query<{ name: string }>("SELECT name FROM _migrations ORDER BY id");
    const appliedSet = new Set(applied.rows.map((r) => r.name));
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await db.query("COMMIT");
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      }
    }
  }, 30000);

  afterAll(async () => {
    // Clean up test data
    try {
      await db.query("DELETE FROM optimization_actions");
      await db.query("DELETE FROM alerts");
      await db.query("DELETE FROM performance_snapshots");
      await db.query("DELETE FROM ranking_snapshots");
      await db.query("DELETE FROM content_items");
      await db.query("DELETE FROM pages");
      await db.query("DELETE FROM keyword_clusters");
      await db.query("DELETE FROM city_keyword_map");
    } catch (_) {
      // Ignore cleanup errors
    }

    await db.end();

    // Clean up temp Hugo directory
    try { fs.rmSync(tmpHugoDir, { recursive: true }); } catch (_) { /* ignore */ }
  });

  it("runs Agent 1 keyword research and populates DB", async () => {
    const mockLlm = createMockLlmClient();
    const config: Agent1Config = {
      niche: "pest-control",
      candidateCities: [
        { city: "Santa Cruz", state: "CA", population: 65000 },
      ],
    };

    await runAgent1(config, mockLlm, db);

    // Verify keyword clusters were created
    const clusters = await db.query(
      "SELECT * FROM keyword_clusters WHERE city = 'Santa Cruz' AND niche = 'pest-control'"
    );
    expect(clusters.rows.length).toBeGreaterThan(0);

    // Verify city keyword map was created
    const cityMap = await db.query(
      "SELECT * FROM city_keyword_map WHERE city = 'Santa Cruz' AND niche = 'pest-control'"
    );
    expect(cityMap.rows.length).toBeGreaterThan(0);
  }, 30000);

  it("runs Agent 3 site builder and creates Hugo content files", async () => {
    const mockLlm = createMockLlmClient();
    const niche = "pest-control-agent3-test";
    const config: Agent3Config = {
      niche,
      hugoSitePath: tmpHugoDir,
      phone: "(555) 123-4567",
      minWordCountHub: 100,
      minWordCountSubpage: 100,
    };

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
        niche,
        "emergency",
        JSON.stringify({ sections: ["hero", "trust", "services", "faq", "cta"] }),
        JSON.stringify([{ name: "hero", type: "split" }, { name: "trust ribbon", type: "band" }]),
        JSON.stringify({ primary: "#FF6B00", secondary: "#1A1A2E", tertiary: "#F4EFE6", highlight: "#2A9D8F" }),
        JSON.stringify({ heading: "Inter", body: "Open Sans" }),
        JSON.stringify({ mobile: 375, tablet: 768, desktop: 1200 }),
      ]
    );
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
        niche,
        JSON.stringify(["Stop infestations before they spread", "Fast local pest control with clear next steps"]),
        JSON.stringify(["Request Same-Day Service", "Book a Free Inspection"]),
        JSON.stringify(["Licensed local technicians", "Same-day appointments", "Straightforward treatment plans"]),
        JSON.stringify([{ question: "How does your first inspection work?", answer_template: "We inspect the property, identify pest pressure, and explain the treatment plan before service starts." }]),
        JSON.stringify([{ problem: "Active infestation", agitate: "Pests spread quickly through hidden access points", solve: "Targeted treatment and exclusion plan" }]),
      ]
    );
    await db.query(
      `INSERT INTO schema_templates (niche, jsonld_templates)
       VALUES ($1, $2)
       ON CONFLICT (niche) DO UPDATE SET
         jsonld_templates = EXCLUDED.jsonld_templates`,
      [
        niche,
        JSON.stringify({
          city_hub: { "@context": "https://schema.org", "@type": "PestControlService" },
          service_subpage: { "@context": "https://schema.org", "@type": "Service" },
        }),
      ]
    );
    await db.query(
      `INSERT INTO seasonal_calendars (niche, months)
       VALUES ($1, $2)
       ON CONFLICT (niche) DO UPDATE SET
         months = EXCLUDED.months`,
      [
        niche,
        JSON.stringify([
          {
            month: 3,
            name: "March",
            primary_pests: ["termites", "ants"],
            content_topics: ["spring swarms", "foundation entry points"],
            messaging_priority: "prevent spring infestation growth",
            seasonal_keywords: ["termite inspection", "ant control"],
          },
        ]),
      ]
    );
    const hubCluster = await db.query<{ id: string }>(
      `INSERT INTO keyword_clusters
       (cluster_name, primary_keyword, secondary_keywords, search_volume, difficulty, intent, city, state, niche)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        "pest control",
        "Santa Cruz pest control",
        ["pest control Santa Cruz", "exterminator Santa Cruz"],
        320,
        35,
        "transactional",
        "Santa Cruz",
        "CA",
        niche,
      ]
    );
    const termiteCluster = await db.query<{ id: string }>(
      `INSERT INTO keyword_clusters
       (cluster_name, primary_keyword, secondary_keywords, search_volume, difficulty, intent, city, state, niche)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        "termite control",
        "Santa Cruz termite control",
        ["termite inspection Santa Cruz"],
        150,
        30,
        "transactional",
        "Santa Cruz",
        "CA",
        niche,
      ]
    );
    await db.query(
      `INSERT INTO city_keyword_map
       (city, state, population, priority_score, keyword_cluster_ids, url_mapping, niche)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        "Santa Cruz",
        "CA",
        65000,
        85,
        [hubCluster.rows[0].id, termiteCluster.rows[0].id],
        JSON.stringify({
          "/santa-cruz/": "Santa Cruz pest control",
          "/santa-cruz/termite-control/": "Santa Cruz termite control",
        }),
        niche,
      ]
    );
    await runAgent3(config, mockLlm, db);

    // Verify Hugo content files were created
    const contentDir = path.join(tmpHugoDir, "content");
    expect(fs.existsSync(contentDir)).toBe(true);

    // Check for city hub page
    const santaCruzDir = path.join(contentDir, "santa-cruz");
    expect(fs.existsSync(santaCruzDir)).toBe(true);

    const indexFile = path.join(santaCruzDir, "_index.md");
    expect(fs.existsSync(indexFile)).toBe(true);

    // Verify frontmatter
    const indexContent = fs.readFileSync(indexFile, "utf-8");
    expect(indexContent).toContain("---");
    expect(indexContent).toContain("Santa Cruz");

    // Verify content_items were stored
    const contentItems = await db.query(
      "SELECT * FROM content_items WHERE city = 'Santa Cruz' AND niche = $1",
      [niche]
    );
    expect(contentItems.rows.length).toBeGreaterThan(0);

    // Verify pages were registered
    const pages = await db.query(
      "SELECT * FROM pages WHERE city = 'Santa Cruz' AND niche = $1",
      [niche]
    );
    expect(pages.rows.length).toBeGreaterThan(0);
  }, 30000);

  it("evaluates Agent 7 thresholds against mock performance data", () => {
    // Simulate healthy metrics
    const goodResult = evaluateThresholds({
      bounceRate: 0.35,
      clickToCallRate: 0.10,
      callQualificationRate: 0.60,
      avgSessionDuration: 150,
    });

    expect(goodResult.bounceRate.severity).toBe("good");
    expect(goodResult.clickToCallRate.severity).toBe("good");
    expect(goodResult.callQualificationRate.severity).toBe("good");
    expect(goodResult.avgSessionDuration.severity).toBe("good");

    // Simulate poor metrics (should generate alerts)
    const badResult = evaluateThresholds({
      bounceRate: 0.72,
      clickToCallRate: 0.02,
      callQualificationRate: 0.20,
      avgSessionDuration: 15,
    });

    expect(badResult.bounceRate.severity).toBe("critical");
    expect(badResult.clickToCallRate.severity).toBe("critical");
    expect(badResult.callQualificationRate.severity).toBe("critical");
    expect(badResult.avgSessionDuration.severity).toBe("critical");
  });

  it("calculates portfolio health scores correctly", () => {
    const healthyScore = calculateHealthScore({
      indexingRate: 1.0,
      rankingProgress: 0.8,
      trafficTrend: 0.9,
      conversionRate: 0.10,
      callQualityRate: 0.60,
      revenueTrend: 0.85,
      criticalAlerts: 0,
    });

    expect(healthyScore).toBeGreaterThanOrEqual(80);
    expect(interpretScore(healthyScore)).toBe("Thriving");

    const poorScore = calculateHealthScore({
      indexingRate: 0.3,
      rankingProgress: 0.1,
      trafficTrend: 0.2,
      conversionRate: 0.01,
      callQualityRate: 0.20,
      revenueTrend: 0.1,
      criticalAlerts: 5,
    });

    expect(poorScore).toBeLessThan(40);
    expect(interpretScore(poorScore)).toBe("Critical intervention required");
  });
});

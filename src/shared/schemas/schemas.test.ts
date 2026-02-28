import { describe, it, expect } from "@jest/globals";
import { z } from "zod/v4";
import {
  KeywordClusterSchema,
  CityKeywordMapSchema,
  DesignSpecSchema,
  CopyFrameworkSchema,
  AgentTaskSchema,
  DlqEntrySchema,
  PageSchema,
  PerformanceSnapshotSchema,
  ContentItemSchema,
} from "./index.js";

describe("Zod schemas", () => {
  it("validates a keyword cluster", () => {
    const data = {
      cluster_name: "pest control",
      primary_keyword: "pest control santa cruz",
      secondary_keywords: ["exterminator santa cruz", "bug control santa cruz"],
      search_volume: 320,
      difficulty: 35.5,
      intent: "transactional",
    };
    expect(() => KeywordClusterSchema.parse(data)).not.toThrow();
  });

  it("rejects invalid keyword cluster intent", () => {
    const data = {
      cluster_name: "test",
      primary_keyword: "test",
      secondary_keywords: [],
      search_volume: 100,
      difficulty: 50,
      intent: "invalid_intent",
    };
    expect(() => KeywordClusterSchema.parse(data)).toThrow();
  });

  it("generates JSON Schema from keyword cluster", () => {
    const jsonSchema = z.toJSONSchema(KeywordClusterSchema);
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toHaveProperty("primary_keyword");
  });

  it("validates a city keyword map", () => {
    const data = {
      city: "Santa Cruz",
      state: "CA",
      population: 65000,
      priority_score: 78.5,
      keyword_clusters: [],
      url_mapping: { hub: "/santa-cruz/", services: { termites: "/santa-cruz/termites/" } },
    };
    expect(() => CityKeywordMapSchema.parse(data)).not.toThrow();
  });

  it("validates a design spec", () => {
    const data = {
      niche: "pest-control",
      archetype: "emergency",
      layout: { sections: ["hero", "trust", "services", "faq", "cta"] },
      components: [{ name: "hero", type: "full-width" }],
      colors: { primary: "#FF6B00", secondary: "#1A1A2E" },
      typography: { heading: "Inter", body: "Open Sans" },
      responsive_breakpoints: { mobile: 375, tablet: 768, desktop: 1200 },
    };
    expect(() => DesignSpecSchema.parse(data)).not.toThrow();
  });

  it("validates an agent task", () => {
    const data = {
      task_type: "keyword_research",
      agent_name: "agent-1",
      payload: { niche: "pest-control", cities: ["Santa Cruz"] },
      status: "pending",
      dependencies: [],
    };
    expect(() => AgentTaskSchema.parse(data)).not.toThrow();
  });
});

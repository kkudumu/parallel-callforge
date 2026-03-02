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
  OfferGeoCoverageSchema,
  DeploymentCandidateSchema,
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
      archetype: "local-authority",
      layout: {
        primary_archetype: "local-authority",
        supported_archetypes: [
          {
            name: "emergency-responder",
            intent: "urgent",
            cvr_range: "15-30%",
            best_for: ["wasps", "wildlife", "bed bugs"],
            section_order: ["header", "hero", "trust", "process", "guarantee", "cta"],
          },
        ],
        section_order: ["header", "hero", "trust", "services", "faq", "cta"],
        section_rules: [
          {
            section: "hero",
            purpose: "Drive immediate calls",
            required_elements: ["headline", "phone", "call button"],
            repeats_primary_cta: true,
          },
          {
            section: "trust",
            purpose: "Reduce skepticism",
            required_elements: ["reviews", "license", "insured"],
            repeats_primary_cta: false,
          },
          {
            section: "cta",
            purpose: "Close late-stage visitors",
            required_elements: ["call button", "microcopy"],
            repeats_primary_cta: true,
          },
        ],
        conversion_strategy: {
          primary_cta_type: "call",
          no_forms: true,
          cta_labels: ["Call Now", "Call For Free Inspection", "Talk To A Local Pro"],
          cta_placements: ["header", "hero", "mid-page", "sticky-footer", "final-cta"],
          sticky_mobile_call_cta: true,
          phone_mentions_min: 4,
        },
        trust_strategy: {
          above_fold: ["star rating", "licensed and insured"],
          mid_page: ["testimonials", "guarantee"],
          near_cta: ["call recording note"],
          footer: ["disclaimer", "privacy links"],
        },
        content_rules: {
          city_hub_words: { min: 400, max: 700 },
          service_page_words: { min: 500, max: 900 },
          reading_grade_target: "5th-7th grade",
          sentence_style: "short, direct, concrete",
        },
      },
      components: [
        {
          name: "sticky-call-bar",
          type: "mobile-footer",
          purpose: "Persistent click-to-call",
          mobile_behavior: "fixed bottom",
          required: true,
        },
      ],
      colors: {
        primary: "#1B5E20",
        secondary: "#263238",
        background: "#FFFFFF",
        surface: "#F5F5F5",
        cta_primary: "#FF6D00",
        cta_primary_hover: "#E65100",
        urgency: "#D32F2F",
        text: "#424242",
        text_muted: "#757575",
        trust: "#2E7D32",
      },
      typography: {
        heading: "Inter, system-ui, sans-serif",
        body: "Inter, system-ui, sans-serif",
        body_size_desktop: "18px",
        body_size_mobile: "16px",
        cta_size: "18px",
      },
      responsive_breakpoints: {
        mobile: 0,
        phablet: 480,
        tablet: 768,
        laptop: 1024,
        desktop: 1280,
      },
    };
    expect(() => DesignSpecSchema.parse(data)).not.toThrow();
  });

  it("validates a copy framework", () => {
    const data = {
      niche: "pest-control",
      headlines: ["Call Now For Same-Day Pest Control In {city}"],
      ctas: ["Call Now - Free Inspection"],
      cta_microcopy: ["No obligation • Takes 30 seconds • Same-day appointments available."],
      trust_signals: ["Licensed & Insured", "4.9★ Rated by Local Customers"],
      guarantees: ["Free re-service if pests return between visits."],
      reading_level: {
        target_grade_min: 5,
        target_grade_max: 7,
        tone: "direct and reassuring",
        banned_phrases: ["when it comes to", "in conclusion"],
      },
      vertical_angles: {
        general_pest: "Fast relief and family-safe treatment",
        termites: "Prevent expensive structural damage",
        bed_bugs: "Stop bites and sleep disruption now",
        wildlife_rodents: "Remove health risks and seal entry points",
      },
      faq_templates: [
        {
          question: "How fast can you get here?",
          answer_template: "Call {phone} for same-day availability in {city}.",
        },
      ],
      pas_scripts: [
        {
          problem: "You are seeing ants in the kitchen.",
          agitate: "The visible ants are rarely the whole colony.",
          solve: "Call {phone} for a fast inspection and targeted treatment.",
        },
      ],
    };
    expect(() => CopyFrameworkSchema.parse(data)).not.toThrow();
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

  it("validates offer geo coverage rows", () => {
    expect(() => OfferGeoCoverageSchema.parse({
      offer_id: "offer-123",
      zip_code: "95060",
      source: "api",
    })).not.toThrow();
  });

  it("validates deployment candidates", () => {
    expect(() => DeploymentCandidateSchema.parse({
      offer_id: "offer-123",
      city: "Santa Cruz",
      state: "CA",
      zip_codes: ["95060", "95062"],
      eligible_zip_count: 2,
      population: 76000,
      pre_keyword_score: 71.25,
      keyword_score: 84,
      final_score: 77.63,
      status: "researched",
      reasoning: {
        summary: "Strong clustered coverage in a mid-sized city",
      },
    })).not.toThrow();
  });
});

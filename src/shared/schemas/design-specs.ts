import { z } from "zod/v4";

export const DesignSpecSchema = z.object({
  niche: z.string().min(1).describe("Service niche"),
  archetype: z.string().min(1).describe("Page archetype name"),
  layout: z.object({
    primary_archetype: z.string().min(1).describe("Default page archetype for this niche"),
    supported_archetypes: z.array(z.object({
      name: z.string().min(1),
      intent: z.string().min(1),
      cvr_range: z.string().min(1),
      best_for: z.array(z.string()).min(1),
      section_order: z.array(z.string()).min(3),
    })).min(1).describe("Catalog of supported archetypes for the niche"),
    section_order: z.array(z.string()).min(3).describe("Default section order"),
    section_rules: z.array(z.object({
      section: z.string().min(1),
      purpose: z.string().min(1),
      required_elements: z.array(z.string()).min(1),
      repeats_primary_cta: z.boolean(),
    })).min(3).describe("Required section-by-section implementation rules"),
    conversion_strategy: z.object({
      primary_cta_type: z.literal("call"),
      no_forms: z.literal(true),
      cta_labels: z.array(z.string()).min(3),
      cta_placements: z.array(z.string()).min(3),
      sticky_mobile_call_cta: z.literal(true),
      phone_mentions_min: z.number().int().min(3),
    }).describe("Pay-per-call conversion requirements"),
    trust_strategy: z.object({
      above_fold: z.array(z.string()).min(2),
      mid_page: z.array(z.string()).min(2),
      near_cta: z.array(z.string()).min(1),
      footer: z.array(z.string()).min(1),
    }).describe("Trust signal placement hierarchy"),
    content_rules: z.object({
      city_hub_words: z.object({
        min: z.number().int().min(200),
        max: z.number().int().min(200),
      }),
      service_page_words: z.object({
        min: z.number().int().min(300),
        max: z.number().int().min(300),
      }),
      reading_grade_target: z.string().min(1),
      sentence_style: z.string().min(1),
    }).describe("Copy-length and readability targets"),
  }).describe("Structured layout and conversion playbook"),
  components: z.array(z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    purpose: z.string().min(1),
    mobile_behavior: z.string().min(1),
    required: z.boolean(),
  })).describe("UI components"),
  colors: z.object({
    primary: z.string(),
    secondary: z.string(),
    background: z.string(),
    surface: z.string(),
    cta_primary: z.string(),
    cta_primary_hover: z.string(),
    urgency: z.string(),
    text: z.string(),
    text_muted: z.string(),
    trust: z.string(),
  }).describe("Color palette"),
  typography: z.object({
    heading: z.string(),
    body: z.string(),
    body_size_desktop: z.string(),
    body_size_mobile: z.string(),
    cta_size: z.string(),
  }).describe("Font configuration"),
  responsive_breakpoints: z.object({
    mobile: z.number().int().min(0),
    phablet: z.number().int().min(320),
    tablet: z.number().int().min(480),
    laptop: z.number().int().min(768),
    desktop: z.number().int().min(1024),
  }).describe("Breakpoints in px"),
});

export type DesignSpec = z.infer<typeof DesignSpecSchema>;

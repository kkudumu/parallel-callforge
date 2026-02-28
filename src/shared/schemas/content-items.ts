import { z } from "zod/v4";

export const ContentItemSchema = z.object({
  title: z.string().min(1).describe("Content title"),
  slug: z.string().min(1).describe("URL slug"),
  status: z.enum(["draft", "review", "published", "archived"]).default("draft"),
  target_keyword: z.string().optional(),
  search_volume: z.number().int().optional(),
  keyword_difficulty: z.number().optional(),
  pest_type: z.string().optional(),
  city: z.string().optional(),
  content_type: z
    .enum(["city_hub", "service_subpage", "blog_post"])
    .describe("Content type"),
  author_persona: z.string().optional(),
  quality_score: z.record(z.string(), z.any()).optional(),
  word_count: z.number().int().optional(),
  niche: z.string().default("pest-control"),
});

export type ContentItem = z.infer<typeof ContentItemSchema>;

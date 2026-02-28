import { z } from "zod/v4";

export const CityKeywordMapSchema = z.object({
  city: z.string().min(1).describe("City name"),
  state: z.string().length(2).describe("Two-letter state code"),
  population: z.number().int().min(0).describe("City population"),
  priority_score: z.number().min(0).max(100).describe("City priority score 0-100"),
  keyword_clusters: z.array(z.any()).describe("Associated keyword clusters"),
  url_mapping: z
    .record(z.string(), z.any())
    .describe("URL path mapping for city pages"),
});

export type CityKeywordMap = z.infer<typeof CityKeywordMapSchema>;

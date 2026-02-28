import { z } from "zod/v4";

export const PageSchema = z.object({
  url: z.string().describe("Full page URL"),
  slug: z.string().describe("URL slug"),
  city: z.string().describe("City name"),
  state: z.string().length(2).describe("Two-letter state code"),
  niche: z.string().default("pest-control"),
  target_keyword: z.string().optional(),
  status: z.enum(["active", "paused", "sunset"]).default("active"),
});

export type Page = z.infer<typeof PageSchema>;

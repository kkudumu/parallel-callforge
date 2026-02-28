import { z } from "zod/v4";

export const KeywordClusterSchema = z.object({
  cluster_name: z.string().min(1).max(255).describe("Keyword cluster name"),
  primary_keyword: z.string().min(1).describe("Main SEO target keyword"),
  secondary_keywords: z.array(z.string()).describe("Related keywords"),
  search_volume: z.number().int().min(0).describe("Monthly search volume"),
  difficulty: z.number().min(0).max(100).describe("Keyword difficulty 0-100"),
  intent: z
    .enum(["informational", "transactional", "navigational", "commercial"])
    .describe("Search intent classification"),
});

export type KeywordCluster = z.infer<typeof KeywordClusterSchema>;

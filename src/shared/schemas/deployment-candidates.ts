import { z } from "zod/v4";

export const DeploymentCandidateStatusSchema = z.enum([
  "pending",
  "researched",
  "approved",
  "rejected",
  "deployed",
]);

export const DeploymentCandidateSchema = z.object({
  offer_id: z.string().min(1).describe("Offer identifier"),
  city: z.string().min(1).describe("City name"),
  state: z.string().length(2).describe("Two-letter state code"),
  zip_codes: z.array(z.string().regex(/^\d{5}$/)).describe("Eligible ZIP codes"),
  eligible_zip_count: z.number().int().min(0).describe("Eligible ZIP count"),
  population: z.number().int().min(0).describe("Population proxy"),
  pre_keyword_score: z.number().min(0).max(100).describe("Deterministic score"),
  keyword_score: z.number().min(0).max(100).nullable().optional(),
  final_score: z.number().min(0).max(100).nullable().optional(),
  status: DeploymentCandidateStatusSchema.default("pending"),
  reasoning: z.record(z.string(), z.any()).describe("Scoring rationale"),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export type DeploymentCandidate = z.infer<typeof DeploymentCandidateSchema>;

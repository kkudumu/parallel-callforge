import { z } from "zod/v4";

export const OfferGeoCoverageSchema = z.object({
  offer_id: z.string().min(1).describe("Offer identifier"),
  zip_code: z.string().regex(/^\d{5}$/).describe("Normalized ZIP code"),
  source: z.string().min(1).default("import").describe("Coverage source"),
  created_at: z.date().optional(),
});

export type OfferGeoCoverage = z.infer<typeof OfferGeoCoverageSchema>;

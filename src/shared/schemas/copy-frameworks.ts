import { z } from "zod/v4";

export const CopyFrameworkSchema = z.object({
  niche: z.string().min(1).describe("Service niche"),
  headlines: z.array(z.string()).describe("Headline formulas"),
  ctas: z.array(z.string()).describe("CTA text variations"),
  cta_microcopy: z
    .array(z.string())
    .min(1)
    .describe("Doubt-removing CTA microcopy repeated beneath call buttons"),
  trust_signals: z.array(z.string()).describe("Trust signal text"),
  guarantees: z
    .array(z.string())
    .min(1)
    .describe("Guarantee and reassurance copy blocks"),
  reading_level: z.object({
    target_grade_min: z.number().int().min(1).max(12),
    target_grade_max: z.number().int().min(1).max(12),
    tone: z.string().min(1),
    banned_phrases: z.array(z.string()),
  }).describe("Readability and tone requirements"),
  vertical_angles: z.object({
    general_pest: z.string().min(1),
    termites: z.string().min(1),
    bed_bugs: z.string().min(1),
    wildlife_rodents: z.string().min(1),
    ants: z.string().optional(),
    spiders: z.string().optional(),
    cockroaches: z.string().optional(),
    mosquitoes: z.string().optional(),
  }).describe("Core emotional angle by pest vertical"),
  faq_templates: z
    .array(z.object({ question: z.string(), answer_template: z.string() }))
    .describe("FAQ templates"),
  pas_scripts: z
    .array(
      z.object({
        problem: z.string(),
        agitate: z.string(),
        solve: z.string(),
      })
    )
    .describe("Problem-Agitate-Solve scripts"),
});

export type CopyFramework = z.infer<typeof CopyFrameworkSchema>;

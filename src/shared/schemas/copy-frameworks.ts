import { z } from "zod/v4";

export const CopyFrameworkSchema = z.object({
  niche: z.string().min(1).describe("Service niche"),
  headlines: z.array(z.string()).describe("Headline formulas"),
  ctas: z.array(z.string()).describe("CTA text variations"),
  trust_signals: z.array(z.string()).describe("Trust signal text"),
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

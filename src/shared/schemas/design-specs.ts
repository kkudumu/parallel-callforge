import { z } from "zod/v4";

export const DesignSpecSchema = z.object({
  niche: z.string().min(1).describe("Service niche"),
  archetype: z.string().min(1).describe("Page archetype name"),
  layout: z.record(z.string(), z.any()).describe("Layout specification"),
  components: z.array(z.record(z.string(), z.any())).describe("UI components"),
  colors: z.record(z.string(), z.string()).describe("Color palette"),
  typography: z.record(z.string(), z.string()).describe("Font configuration"),
  responsive_breakpoints: z
    .record(z.string(), z.number())
    .describe("Breakpoints in px"),
});

export type DesignSpec = z.infer<typeof DesignSpecSchema>;

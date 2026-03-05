import {
  COMPETITOR_ANALYSIS_PROMPT,
  DESIGN_SPEC_PROMPT,
  COPY_FRAMEWORK_PROMPT,
  SCHEMA_TEMPLATE_PROMPT,
  SEASONAL_CALENDAR_PROMPT,
} from "./prompts.js";

describe("legacy prompt exports", () => {
  it("keep {niche} placeholder for strategy compatibility", () => {
    expect(COMPETITOR_ANALYSIS_PROMPT).toContain('"{niche}"');
    expect(COPY_FRAMEWORK_PROMPT).toContain('"{niche}"');
    expect(SCHEMA_TEMPLATE_PROMPT).toContain('"{niche}"');
    expect(SEASONAL_CALENDAR_PROMPT).toContain('"{niche}"');
  });

  it("keeps both placeholders in design spec prompt", () => {
    expect(DESIGN_SPEC_PROMPT).toContain('"{niche}"');
    expect(DESIGN_SPEC_PROMPT).toContain("{competitor_analysis}");
  });
});

export interface SynthesisPromptContext {
  competitorResearch?: string | null;
  croResearch?: string | null;
  designResearch?: string | null;
  copyResearch?: string | null;
  schemaResearch?: string | null;
  seasonalResearch?: string | null;
}

function researchBlock(label: string, content: string | null | undefined): string {
  if (!content) return "";
  return `\n\n=== ${label} ===\n${content}`;
}

export function buildCompetitorAnalysisPrompt(
  niche: string,
  ctx?: SynthesisPromptContext
): string {
  const research =
    researchBlock("COMPETITOR RESEARCH", ctx?.competitorResearch) +
    researchBlock("CRO DATA", ctx?.croResearch);

  return `You are a CRO analyst specializing in local service business landing pages.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Analyze the top-performing landing page patterns for the "${niche}" niche and produce a competitor analysis.

This system is pay-per-call. Users should be pushed toward phone calls, not web forms.

${research ? "Base your analysis on the research above. Cite specific findings where relevant. Do not hallucinate data — only use what is in the research." : ""}

Focus on:
- Common page layouts and section ordering
- Trust signal placement (reviews, certifications, guarantees)
- CTA patterns (phone numbers, repeated call buttons, sticky call bars, call badges)
- Content structure (headlines, subheadlines, body copy length)
- Mobile optimization patterns
- Schema markup usage
- Social proof elements
- Differences between emergency intent, city hub intent, pest-specific intent, trust-first local authority, and qualifier patterns

Output ONLY valid JSON matching the provided schema.`;
}

export function buildDesignSpecPrompt(
  niche: string,
  competitorAnalysisJson: string,
  ctx?: SynthesisPromptContext
): string {
  const research =
    researchBlock("COMPETITOR RESEARCH", ctx?.competitorResearch) +
    researchBlock("DESIGN RESEARCH", ctx?.designResearch) +
    researchBlock("CRO DATA", ctx?.croResearch);

  return `You are a UI/UX designer specializing in high-converting local service landing pages.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Create a complete design specification for the "${niche}" niche based on this competitor analysis:
${competitorAnalysisJson}

This build is for a pay-per-call publisher. Enforce these non-negotiables:
- The primary CTA is a phone call
- No user-facing forms
- Repeat one call-focused CTA type in multiple positions
- Keep click-to-call highly visible on mobile and desktop

${research ? "Use specific data from the research above (CVR percentages, A/B test results, pixel measurements) as evidence for your design decisions. Include CSS specifications where the research provides them." : ""}

Build a structured playbook that includes:
- A selected primary archetype for "${niche}"
- A catalog of five supported archetypes with expected CVR ranges
- Complete color palette with hex codes and rationale
- Typography scale with desktop and mobile sizes
- Layout grid specification
- Responsive breakpoints
- CTA button CSS specification
- CTA placement frequency rules

Return a structured design system matching the schema exactly.

Output ONLY valid JSON matching the provided schema.`;
}

export function buildCopyFrameworkPrompt(
  niche: string,
  ctx?: SynthesisPromptContext
): string {
  const research =
    researchBlock("COPY RESEARCH", ctx?.copyResearch) +
    researchBlock("CRO DATA", ctx?.croResearch);

  return `You are a direct-response copywriter for local service businesses.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Create a copy framework for the "${niche}" niche.

${research ? "Ground every recommendation in the research above. Tag each formula as either A/B-test-proven or industry best practice. Include the % lift data where available." : ""}

Include:
1. Headline formulas (10-15) using loss aversion, authority, urgency, and benefit patterns — with examples for all four verticals (general pest, termites, bed bugs, wildlife/rodents)
2. CTA text ranked by performance (cite test data where available) — phone call CTAs only, no forms
3. CTA microcopy (3-6) for reducing hesitation beneath call buttons
4. Trust signals (6-8) with placement guidance
5. Guarantees (3-6) with specific language
6. Reading level rules (target grade level and why)
7. Vertical emotional angles — one per pest vertical
8. FAQ templates (8-10) with answers
9. PAS scripts (4-6) — one per pest vertical

Use {city}, {phone}, {service}, {pest} as placeholders.

Output ONLY valid JSON matching the provided schema.`;
}

export function buildSchemaTemplatePrompt(
  niche: string,
  ctx?: SynthesisPromptContext
): string {
  const research = researchBlock("SCHEMA RESEARCH", ctx?.schemaResearch);

  return `You are a structured data specialist for local SEO.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Create JSON-LD schema templates for the "${niche}" niche.

${research ? "Use the research above to ensure templates are spec-compliant. Follow the specific schema.org types and property patterns identified in the research." : ""}

Include complete, production-ready JSON-LD for:
1. Primary PestControlService schema — uses areaServed (NOT a street address) for rank-and-rent sites without a GBP
2. FAQPage schema — with visible-on-page requirement noted in comments
3. Service schema — one per pest vertical (general, termites, bed bugs, rodents, wildlife)
4. Review/AggregateRating schema — with note that reviewed items must be visible on page
5. BreadcrumbList schema

All templates must be valid JSON-LD and use {city}, {state}, {phone}, {business_name} as placeholders.

Output ONLY valid JSON matching the provided schema.`;
}

export function buildSeasonalCalendarPrompt(
  niche: string,
  ctx?: SynthesisPromptContext
): string {
  const research = researchBlock("SEASONAL RESEARCH", ctx?.seasonalResearch);

  return `You are a pest control industry analyst.
${research ? `\nYou have the following research from real sources:${research}\n` : ""}
Create a 12-month seasonal content calendar for the "${niche}" niche.

${research ? "Use the research above to ground every month's recommendations in real pest activity data, not assumptions. Cite specific regional patterns where the research provides them." : ""}

For each month (January through December):
- Primary pests active in that period (with regional variation: Southeast, Southwest, Northeast, Midwest)
- Recommended content topics
- Messaging priorities (prevention vs treatment vs emergency)
- Seasonal keywords to target
- Marketing urgency level (low/medium/high/critical)
- Regional overrides where pest timing differs significantly by climate

This calendar guides Agent 3's content and Agent 7's seasonal performance benchmarks.

Output ONLY valid JSON matching the provided schema.`;
}

// Legacy named exports for backward compatibility during migration
// These are used by the vertical strategy system which has not been updated yet
export const COMPETITOR_ANALYSIS_PROMPT = buildCompetitorAnalysisPrompt("{niche}");
export const DESIGN_SPEC_PROMPT = buildDesignSpecPrompt("{niche}", "{competitor_analysis}");
export const COPY_FRAMEWORK_PROMPT = buildCopyFrameworkPrompt("{niche}");
export const SCHEMA_TEMPLATE_PROMPT = buildSchemaTemplatePrompt("{niche}");
export const SEASONAL_CALENDAR_PROMPT = buildSeasonalCalendarPrompt("{niche}");

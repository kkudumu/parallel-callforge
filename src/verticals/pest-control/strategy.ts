import { createDefaultStrategy } from "../default/strategy.js";
import type { VerticalStrategy } from "../types.js";

const PEST_CONTROL_KEYWORD_TEMPLATE_PROMPT = `You are an SEO keyword research specialist for local service businesses.

Generate keyword templates for the "{niche}" niche that can be expanded per city.
Each template uses {city} as a placeholder.

Focus on:
- High commercial intent (people ready to hire)
- Local service variations
- Emergency/urgent variations
- Cost/pricing queries
- "Near me" variations (map to city pages)

Generate 20-30 keyword patterns. Examples:
- "{city} pest control"
- "exterminator in {city}"
- "termite treatment {city}"
- "emergency pest control {city}"
- "pest control cost {city}"

Output ONLY valid JSON matching the provided schema.`;

const PEST_CONTROL_COMPETITOR_ANALYSIS_PROMPT = `You are a CRO (conversion rate optimization) analyst specializing in local service businesses.

Analyze the top-performing landing page patterns for the "{niche}" niche and produce a competitor analysis.

This system is pay-per-call. Users should be pushed toward phone calls, not web forms.

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

const PEST_CONTROL_DESIGN_SPEC_PROMPT = `You are a UI/UX designer specializing in high-converting local service landing pages.

Create a complete design specification for the "{niche}" niche based on this competitor analysis:
{competitor_analysis}

This build is for a pay-per-call publisher. Enforce these non-negotiables:
- The primary CTA is a phone call
- No user-facing forms
- Repeat one call-focused CTA type in multiple positions
- Keep click-to-call highly visible on mobile and desktop

Build a structured pest-control playbook that includes:
- A selected primary archetype for "{niche}"
- A catalog of five supported archetypes:
  1. Emergency Responder
  2. Full-Service Converter
  3. Pest-Specific Specialist
  4. Local Authority
  5. Multi-Step Qualifier

Even though the qualifier archetype exists in the playbook catalog, adapt it for pay-per-call by converting it into a phone-first qualification flow without web forms.

The design must prioritize:
- Mobile-first behavior
- Click-to-call prominence (phone visible above fold, sticky footer on mobile)
- Fast page load (minimal JS, optimized images)
- Trust-building above the fold
- Clear service area identification
- Emergency/urgency messaging where applicable
- A trust placement hierarchy
- Content-length rules for city hubs and service pages
- A single repeated call CTA with explicit placement rules

Return a structured design system matching the schema exactly.

Output ONLY valid JSON matching the provided schema.`;

const PEST_CONTROL_COPY_FRAMEWORK_PROMPT = `You are a direct-response copywriter for local service businesses.

Create a copy framework for the "{niche}" niche that includes:

1. Headline formulas (10-15) using patterns like:
   - "[City]'s #1 [Service] - [Benefit]"
   - "Same-Day [Service] in [City] - Call Now"
   - "[Problem]? [City] [Service] Experts Are Standing By"

2. CTA variations (8-10) optimized for phone calls only:
   - "Call Now - Free Inspection"
   - "Call Now - Same-Day Service"
   - "Call [Phone] To Get Help Today"

3. CTA microcopy (3-6) for reducing hesitation beneath call buttons:
   - "No obligation • Takes 30 seconds • Same-day appointments available."
   - "Fast response • Local routing • No online forms."

4. Trust signals (6-8):
   - "Licensed & Insured Since [Year]"
   - "4.9★ Rating on Google ([Count]+ Reviews)"

5. Guarantees (3-6):
   - "If pests return between visits, we return at no extra cost."
   - "Same-day scheduling available in most service areas."

6. Reading-level rules:
   - Target 5th-7th grade reading level
   - Short sentences
   - Clear, direct, concrete language
   - Avoid vague corporate filler

7. Vertical emotional angles:
   - General pest = convenience + family safety + fast relief
   - Termites = financial loss prevention
   - Bed bugs = urgency + sleep disruption + embarrassment relief
   - Wildlife/rodents = health risk + property damage + humane removal

8. FAQ templates (8-10) with answer templates per common pest/service

9. PAS (Problem-Agitate-Solve) scripts (4-6) for key services

Use {city}, {phone}, {service}, {pest} as placeholders.

Output ONLY valid JSON matching the provided schema.`;

const PEST_CONTROL_SCHEMA_TEMPLATE_PROMPT = `You are a structured data specialist for local SEO.

Create JSON-LD schema templates for the "{niche}" niche that include:

1. Primary business schema with:
   - LocalBusiness type
   - additionalType pointing to a pest-control ontology or category
   - Service area coverage using areaServed
   - Operating hours
   - Payment methods accepted
   - Avoid relying on a physical street address as the primary trust signal for rank-and-rent style pages

2. FAQPage schema template for FAQ sections

3. Service schema for individual service pages
   - Use Service as the page type
   - Nest a LocalBusiness provider object instead of inventing a custom schema type

4. Review/AggregateRating schema template

5. Include notes in the template values that all marked-up reviews must also be visible on page

Use {city}, {state}, {phone}, {business_name}, {address} as placeholders.
Templates should be valid JSON-LD that can be injected into Hugo partials.

Output ONLY valid JSON matching the provided schema.`;

const PEST_CONTROL_SEASONAL_CALENDAR_PROMPT = `You are a pest control industry analyst.

Create a 12-month seasonal content calendar for the "{niche}" niche that maps:

For each month (January through December):
- Primary pests active in that period
- Recommended content topics
- Messaging priorities (prevention vs treatment vs emergency)
- Seasonal keywords to target
- Regional variations (warm vs cold climates)

This calendar guides Agent 3's content scheduling and Agent 7's seasonal performance benchmarks.

Output ONLY valid JSON matching the provided schema.`;

const PEST_CONTROL_CITY_HUB_PROMPT = `You are a local SEO content writer for pest control businesses.

Write a city hub page for {city}, {state} targeting the keyword "{keyword}".

Requirements:
- 800-1,500 words
- Include the city name naturally 5-8 times
- Mention specific neighborhoods, landmarks, or geographic features of {city}
- Include seasonal pest information relevant to the region
- Address common pest problems in {city}'s climate
- Include a clear call-to-action with phone number placeholder {phone}
- Use H2 and H3 headings for structure
- Write in a professional but approachable tone
- Include local trust signals (serving {city} since..., local team...)

Additional Requirements:
- Write at 5th-7th grade reading level. Use short, direct sentences.
- Use PAS (Problem-Agitate-Solve) structure at least once in the body content.
- Include at least one guarantee statement naturally in the copy.
- Mention the phone number at least 4 times throughout the content.

CRITICAL: Do NOT use any of these AI-sounding phrases:
- "it is important to note", "in conclusion", "when it comes to"
- "it's worth noting", "in today's world", "without further ado"
- "dive into", "navigating the", "leverage", "plays a crucial role"

Output ONLY valid JSON matching the provided schema.`;

const PEST_CONTROL_SERVICE_SUBPAGE_PROMPT = `You are an expert pest control content writer.

Write a service subpage about "{pest_type}" pest control in {city}, {state}.
Target keyword: "{keyword}"

Requirements:
- 1,500-2,500 words
- Include the city name 4-6 times
- Cover: identification, signs of infestation, health risks, treatment options, prevention
- Include seasonal timing for {pest_type} in the {state} region
- Address cost expectations (ranges, not exact prices)
- Include FAQ section (4-6 questions)
- Professional, authoritative tone
- Clear CTA sections with phone placeholder {phone}

Additional Requirements:
- Write at 5th-7th grade reading level. Use short, direct sentences.
- Use PAS (Problem-Agitate-Solve) structure at least once in the body content.
- Include at least one guarantee statement naturally in the copy.
- Mention the phone number at least 4 times throughout the content.

CRITICAL: Do NOT use AI-sounding phrases. Write like a local pest control expert.

Output ONLY valid JSON matching the provided schema.`;

export function createPestControlStrategy(): VerticalStrategy {
  const base = createDefaultStrategy("pest-control");
  return {
    ...base,
    getKeywordTemplatePrompt(niche, context) {
      const basePrompt = PEST_CONTROL_KEYWORD_TEMPLATE_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildKeywordTemplateContext(context)}`;
    },
    getCompetitorAnalysisPrompt(niche, context) {
      const basePrompt = PEST_CONTROL_COMPETITOR_ANALYSIS_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getDesignSpecPrompt(input, context) {
      const basePrompt = PEST_CONTROL_DESIGN_SPEC_PROMPT
        .replace("{niche}", input.niche)
        .replace("{competitor_analysis}", input.competitorAnalysisJson);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getCopyFrameworkPrompt(niche, context) {
      const basePrompt = PEST_CONTROL_COPY_FRAMEWORK_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getSchemaTemplatePrompt(niche, context) {
      const basePrompt = PEST_CONTROL_SCHEMA_TEMPLATE_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getSeasonalCalendarPrompt(niche, context) {
      const basePrompt = PEST_CONTROL_SEASONAL_CALENDAR_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getCityHubPrompt(input, context) {
      const basePrompt = `${PEST_CONTROL_CITY_HUB_PROMPT
        .replace(/\{city\}/g, input.city)
        .replace(/\{state\}/g, input.state)
        .replace(/\{keyword\}/g, input.keyword)
        .replace(/\{phone\}/g, input.phone)}

Agent 1 city keyword map (authoritative):
${input.agent1Summary}

Agent 2 design research (authoritative):
${input.agent2Summary}
- Seasonal guidance: ${input.seasonalGuidance}`;
      return `${basePrompt}${this.buildContentGenerationContext(context)}`;
    },
    getServiceSubpagePrompt(input, context) {
      const basePrompt = `${PEST_CONTROL_SERVICE_SUBPAGE_PROMPT
        .replace(/\{city\}/g, input.city)
        .replace(/\{state\}/g, input.state)
        .replace(/\{pest_type\}/g, input.pestType)
        .replace(/\{keyword\}/g, input.keyword)
        .replace(/\{phone\}/g, input.phone)}

Agent 1 city keyword map (authoritative):
${input.agent1Summary}

Agent 2 design research (authoritative):
${input.agent2Summary}
- Seasonal guidance: ${input.seasonalGuidance}`;
      return `${basePrompt}${this.buildContentGenerationContext(context)}`;
    },
    buildKeywordTemplateContext(context) {
      const header = base.buildKeywordTemplateContext(context);
      const extra = [
        "Prefer common household pests over specialty infestations.",
        "Prioritize homeowner-intent keywords unless the offer explicitly allows commercial traffic.",
      ].join(" ");
      return `${header}\n- Pest-control keyword focus: ${extra}`.trimEnd();
    },
    buildDesignResearchContext(context) {
      const header = base.buildDesignResearchContext(context);
      return `${header}\n- Pest-control design focus: Keep trust, urgency, and household safety prominent.`.trimEnd();
    },
    buildContentGenerationContext(context) {
      const header = base.buildContentGenerationContext(context);
      return `${header}\n- Pest-control content focus: Write around infestations, treatment, prevention, and common household pests only.`.trimEnd();
    },
  };
}

export const CITY_HUB_PROMPT = `You are a local SEO content writer for pest control businesses.

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

CRITICAL: Do NOT use any of these AI-sounding phrases:
- "it is important to note", "in conclusion", "when it comes to"
- "it's worth noting", "in today's world", "without further ado"
- "dive into", "navigating the", "leverage", "plays a crucial role"

Output ONLY valid JSON matching the provided schema.`;

export const SERVICE_SUBPAGE_PROMPT = `You are an expert pest control content writer.

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

CRITICAL: Do NOT use AI-sounding phrases. Write like a local pest control expert.

Output ONLY valid JSON matching the provided schema.`;

export const HUGO_TEMPLATE_PROMPT = `You are a Hugo static site generator expert and professional web designer.

Given this design specification, generate three production-quality Hugo HTML templates that look polished, trustworthy, and conversion-optimized:
{design_spec}

## CRITICAL CSS RULES — follow these exactly

The pipeline writes a CSS theme file at /css/generated-theme.css that defines all design tokens. Your baseof.html MUST link to it in the <head>:

    <link rel="stylesheet" href="/css/generated-theme.css">

The theme file defines these CSS custom properties — use ONLY these names in your templates (never invent alternatives):

    --color-primary           (brand primary, use for headings, borders)
    --color-primary-dark      (hover states on primary)
    --color-secondary         (warm accent, subheadings, badges)
    --color-bg-alt            (light warm background for callout blocks)
    --color-success           (green trust color)
    --color-cta-primary       (main CTA button background)
    --color-cta-primary-hover (main CTA hover state)
    --color-urgency           (red for urgency/emergency messaging)
    --color-text              (body text)
    --color-text-muted        (secondary/caption text)
    --color-trust             (trust badge/icon color)
    --color-background        (page background)
    --color-surface           (card/section background)
    --color-border            (dividers, borders)
    --font-heading            (heading font stack)
    --font-body               (body font stack)
    --font-size-cta           (CTA button font size)

Do NOT add <style> blocks that redefine or shadow these variables. You may write component CSS that uses var(--color-primary) etc.

## OUTPUT

Generate three templates:
1. baseof — Full page shell: <html>, <head> with meta/title/stylesheet link, sticky mobile call bar, header with phone, <main> block, footer with NAP/links, structured-data block
2. city_hub — Defines {{ define "main" }}: hero section, services grid, local trust signals, testimonials, CTA
3. service_subpage — Defines {{ define "main" }}: identification section, treatment section, mid-page CTA, prevention tips, FAQ accordion, service areas, related pests, final CTA

## DESIGN REQUIREMENTS
- Mobile-first CSS (min-width breakpoints matching the spec's responsive_breakpoints)
- Sticky click-to-call footer bar on mobile (position: fixed; bottom: 0)
- Phone number visible above the fold
- CTA buttons: min-height 60px, full-width on mobile, high-contrast using var(--color-cta-primary)
- No user-facing forms — call-only CTAs throughout
- FAQ uses <details>/<summary> accordion — no JavaScript required
- Professional, clean layout — avoid emoji overload, trust comes from typography and structure

## HUGO TEMPLATE RULES
- NEVER use {{ range first N .Params.someField }} — this crashes when the field is nil
- Instead always guard with: {{ if .Params.someField }}{{ range first N .Params.someField }}...{{ end }}{{ end }}
- Child templates (city_hub, service_subpage) define blocks only — no <html> or <head> tags
- baseof.html is a full HTML document with {{ block "main" . }}{{ end }} in the body

Output ONLY valid JSON matching the provided schema.`;

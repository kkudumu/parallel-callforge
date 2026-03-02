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

export const HUGO_TEMPLATE_PROMPT = `You are a Hugo static site generator expert.

Given this design specification, generate Hugo HTML templates:
{design_spec}

Generate templates for:
1. baseof.html - Base layout with mobile-first responsive design
2. city-hub.html - City landing page layout
3. service-subpage.html - Individual pest service page layout

Requirements:
- Mobile-first CSS (min-width breakpoints)
- Sticky click-to-call footer on mobile
- Phone number visible above fold
- CTA buttons: min 60px height, full-width on mobile, high-contrast
- No user-facing forms
- Use call-only CTAs throughout the page
- JSON-LD structured data injection point
- FAQ accordion component
- Fast-loading (no external JS dependencies)

Output ONLY valid JSON matching the provided schema.`;

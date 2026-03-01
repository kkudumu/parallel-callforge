export const KEYWORD_TEMPLATE_PROMPT = `You are an SEO keyword research specialist for local service businesses.

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

export const CITY_SCORING_PROMPT = `You are a market analyst for local service lead generation.

Given the following keyword volume data and city information, score each city on a 0-100 scale.

Scoring criteria:
- Population 75K-250K sweet spot (smaller = less competition, larger = more volume)
- Primary keyword search volume 50-500/month (sweet spot for new sites)
- Low keyword difficulty (<30 preferred, <50 acceptable)
- High commercial intent keywords present
- Geographic premium potential (Sun Belt, high pest activity regions score higher)

City data:
{city_data}

Keyword data:
{keyword_data}

Output ONLY valid JSON matching the provided schema.`;

export const KEYWORD_CLUSTERING_PROMPT = `You are an SEO architect specializing in URL structure optimization.

Given these keywords and their metrics for {city}, {state}, group them into clusters
and map each cluster to a URL path.

Rules:
- City hub page ("/[city-slug]/") targets broad "[city] pest control" type keywords
- Service subpages ("/[city-slug]/[service]/") target specific pest types
- Each cluster should have 1 primary keyword and 2-5 secondary keywords
- Classify intent: informational, transactional, navigational, commercial
- For every cluster, use these exact keys: "cluster_name", "primary_keyword", "secondary_keywords", "search_volume", "difficulty", "intent"
- "search_volume" and "difficulty" must always be numbers (use 0 if unknown)
- "url_mapping" must be a flat object where each key is a URL path and each value is a string

Keywords:
{keywords}

Output ONLY valid JSON matching the provided schema.`;

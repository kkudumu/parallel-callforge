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
- Standalone cities: population 50K-300K sweet spot
- Suburbs: population 25K-100K, with parent metro/cluster population above 500K
- If "cluster" metadata is present, evaluate the city inside that metro cluster using the cluster population and anchor city
- If "search_identity_confidence" is present for a suburb, use it as a proxy for how likely residents search using the suburb name
- If "pest_pressure_score" is present, factor it into the opportunity score as a demand proxy
- If a city is marked as "market_type": "suburb" with "metro_parent" metadata, treat it as a valid suburb target even when it would fail standalone-city thresholds
- Primary keyword search volume 50-500/month (sweet spot for new sites)
- Low keyword difficulty (<30 preferred, <50 acceptable)
- High commercial intent keywords present
- Geographic premium potential (Sun Belt, high pest activity regions score higher)

City data:
{city_data}

Keyword data:
{keyword_data}

You MUST return a JSON object with a "scored_cities" array. Each entry MUST include ALL of these fields:
- "city": string (city name)
- "state": string (state abbreviation)
- "population": number (population count)
- "priority_score": number between 0-100 (your score)
- "reasoning": string (1-2 sentence explanation of the score)

Example output format:
{"scored_cities": [{"city": "Springfield", "state": "IL", "population": 115000, "priority_score": 72, "reasoning": "Mid-size market with moderate competition and good search volume."}]}

Output ONLY valid JSON matching this exact structure. No markdown, no extra text.`;

export const KEYWORD_CLUSTERING_PROMPT = `You are an SEO architect specializing in URL structure optimization.

Given these keywords and their metrics for {city}, {state}, group them into clusters.

Rules:
- City hub page targets broad "[city] pest control" type keywords
- Service subpages target specific pest types
- Each cluster should have 1 primary keyword and 2-5 secondary keywords
- Classify intent: informational, transactional, navigational, commercial
- "search_volume" and "difficulty" must always be numbers (use 0 if unknown)

Keywords:
{keywords}

Output ONLY valid JSON matching the provided schema.`;

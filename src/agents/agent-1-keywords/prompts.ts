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

// --- Research-augmented prompt utilities ---

export interface PlaybookSynthesisPromptConfig {
  niche: string;
  researchContext: string;
  runId: string;
}

export function buildPlaybookSynthesisPrompt(cfg: PlaybookSynthesisPromptConfig): string {
  return `You are a market research analyst synthesizing field research into a professional market selection playbook for a ${cfg.niche} lead generation operation.

Run ID: ${cfg.runId}

You have been given research findings from 6 parallel research subagents that browsed real web sources. Your job is to synthesize these findings into a single comprehensive market selection playbook.

RESEARCH INPUT:
${cfg.researchContext}

---

Produce a market selection playbook in this EXACT structure. Do not skip any section. Use real numbers and cite sources from the research. Only cite evidence found in the research input above — do not invent data.

# ${cfg.niche.charAt(0).toUpperCase() + cfg.niche.slice(1)} Market Selection Playbook

**Generated:** [today's ISO date] | **Run ID:** ${cfg.runId} | **Sources consulted:** [count the unique URLs in the Source Index sections above]

## Executive Summary
[3-5 bullet points: most important findings, key opportunity thresholds, primary market tier recommendation]

## Market Sizing & Economics
[Industry size, growth rate, CLV, pay-per-call rate ranges by niche — cite from ppc-economics research]

## Two-Pipeline Candidate Logic

### Pipeline A: Standalone Cities (50K–300K)
[Decision thresholds with sources from market-data and gbp-competition research]

### Pipeline B: Suburbs (25K–100K in 500K+ metros)
[Decision thresholds, search identity test requirement, faster ranking rationale]

## Climate & Pest Pressure Scoring
[Scoring model with specific factor weights — cite from market-data research: NOAA, Frostline, HUD TIP zones]

## Competition Scoring Model
[GBP density thresholds, DA benchmarks, review count cutoffs — cite from gbp-competition research]

## Keyword Patterns & Intent Classification
[60+ keyword patterns grouped by intent: emergency / prevention / inspection / treatment / pricing — cite from keyword-patterns research]

## Competitor URL Patterns
[50+ real slug patterns with keyword intent mapping — cite from competitor-keywords research]

## Pay-Per-Call Economics
[Pay-per-call rates by niche, CPL benchmarks by market type, rank-and-rent revenue estimates — cite from ppc-economics research]

## Red Flags: Auto-Disqualify Signals
[Table format: signal | detection method | why it kills the market — cite from all research]

## Free Tool Stack
[Table format: tool | data provided | endpoint | rate limit — cite free tools found in market-data and local-seo research]

## Source Index
[All unique URLs found across all research files, one per line as: - [URL] — [description]]

---

Write the complete playbook now. Length target: 3,000-6,000 words. Do not truncate any section.`;
}

/**
 * Prepend research context to any existing prompt when available.
 * Returns the original prompt unchanged when researchContext is null.
 */
export function withResearchContext(
  prompt: string,
  researchContext: string | null
): string {
  if (!researchContext) {
    return prompt;
  }

  return `The following market research was gathered from real web sources. Use it to ground your response in actual data rather than general knowledge.

=== MARKET RESEARCH CONTEXT ===
${researchContext}
=== END MARKET RESEARCH CONTEXT ===

${prompt}`;
}

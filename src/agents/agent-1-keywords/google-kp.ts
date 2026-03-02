import googleTrends from "google-trends-api";
import type { DbClient } from "../../shared/db/client.js";
import {
  isFreshTimestamp,
  KEYWORD_RESEARCH_TTL_MS,
  normalizeNiche,
} from "../../shared/cache-policy.js";

export interface KeywordMetrics {
  keyword: string;
  avg_monthly_searches: number;
  competition: "LOW" | "MEDIUM" | "HIGH";
  competition_index: number;
  low_top_of_page_bid: number;
  high_top_of_page_bid: number;
}

export interface GoogleKpClient {
  getKeywordIdeas(keywords: string[], locationId?: string): Promise<KeywordMetrics[]>;
}

/**
 * Fetches Google Autocomplete suggestions for a query.
 * Returns ranked suggestions — position correlates with real search popularity.
 */
async function getAutocompleteSuggestions(query: string): Promise<string[]> {
  const url = new URL("https://suggestqueries.google.com/complete/search");
  url.searchParams.set("client", "firefox");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as [string, string[]];
    return Array.isArray(data[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

async function getAutocompleteSuggestionsCached(
  query: string,
  db?: DbClient,
  forceRefresh = false
): Promise<string[]> {
  const cacheKey = query.trim().toLowerCase();
  if (!db) {
    return getAutocompleteSuggestions(cacheKey);
  }

  const cached = await db.query<{ suggestions: string[]; updated_at: Date }>(
    `SELECT suggestions, updated_at
     FROM autocomplete_cache
     WHERE query = $1
     LIMIT 1`,
    [cacheKey]
  );

  const cachedSuggestions = cached.rows[0]?.suggestions;
  if (
    !forceRefresh &&
    Array.isArray(cachedSuggestions) &&
    isFreshTimestamp(cached.rows[0]?.updated_at, KEYWORD_RESEARCH_TTL_MS)
  ) {
    return cachedSuggestions;
  }

  const suggestions = await getAutocompleteSuggestions(cacheKey);
  await db.query(
    `INSERT INTO autocomplete_cache
     (query, suggestions, cache_source, cache_provider, cache_version, retrieval_method, confidence_score, updated_at)
     VALUES ($1, $2, 'estimated', 'google-autocomplete', 'v1', 'estimated', 0.7, now())
     ON CONFLICT (query) DO UPDATE SET
       suggestions = EXCLUDED.suggestions,
       cache_source = EXCLUDED.cache_source,
       cache_provider = EXCLUDED.cache_provider,
       cache_version = EXCLUDED.cache_version,
       retrieval_method = EXCLUDED.retrieval_method,
       confidence_score = EXCLUDED.confidence_score,
       updated_at = now()`,
    [cacheKey, suggestions]
  );

  return suggestions;
}

interface TrendsData {
  topQueries: Map<string, number>;       // query → relative value (0-100)
  risingQueries: Map<string, number>;    // query → growth value
}

/**
 * Fetches Google Trends related queries for a niche keyword.
 * Top queries show established demand, rising queries show growing demand.
 */
async function getTrendsData(niche: string, geo: string): Promise<TrendsData> {
  const topQueries = new Map<string, number>();
  const risingQueries = new Map<string, number>();

  try {
    const result = await googleTrends.relatedQueries({
      keyword: niche,
      geo,
      startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    });

    const parsed = JSON.parse(result);
    const lists = parsed.default?.rankedList ?? [];

    // Top queries (index 0)
    for (const q of lists[0]?.rankedKeyword ?? []) {
      topQueries.set(q.query.toLowerCase(), q.value);
    }

    // Rising queries (index 1)
    for (const q of lists[1]?.rankedKeyword ?? []) {
      risingQueries.set(q.query.toLowerCase(), q.value);
    }
  } catch (err) {
    console.warn(`[GoogleKP] Trends fetch failed: ${err instanceof Error ? err.message : err}`);
  }

  return { topQueries, risingQueries };
}

function objectToMap(input: unknown): Map<string, number> {
  const entries =
    input && typeof input === "object" && !Array.isArray(input)
      ? Object.entries(input as Record<string, unknown>)
      : [];
  return new Map(
    entries
      .filter(([, value]) => typeof value === "number")
      .map(([key, value]) => [key, value as number])
  );
}

function mapToObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(map.entries());
}

async function getTrendsDataCached(
  niche: string,
  geo: string,
  db?: DbClient,
  forceRefresh = false
): Promise<TrendsData> {
  const cacheKey = normalizeNiche(niche);
  if (!db) {
    return getTrendsData(cacheKey, geo);
  }

  const cached = await db.query<{
    top_queries: Record<string, number>;
    rising_queries: Record<string, number>;
    updated_at: Date;
  }>(
    `SELECT top_queries, rising_queries, updated_at
     FROM trends_cache
     WHERE niche = $1
       AND geo = $2
     LIMIT 1`,
    [cacheKey, geo]
  );

  if (
    !forceRefresh &&
    cached.rows[0] &&
    isFreshTimestamp(cached.rows[0].updated_at, KEYWORD_RESEARCH_TTL_MS)
  ) {
    return {
      topQueries: objectToMap(cached.rows[0].top_queries),
      risingQueries: objectToMap(cached.rows[0].rising_queries),
    };
  }

  const trends = await getTrendsData(cacheKey, geo);
  await db.query(
    `INSERT INTO trends_cache
     (niche, geo, top_queries, rising_queries, cache_source, cache_provider, cache_version, retrieval_method, confidence_score, updated_at)
     VALUES ($1, $2, $3, $4, 'estimated', 'google-trends', 'v1', 'estimated', 0.6, now())
     ON CONFLICT (niche, geo) DO UPDATE SET
       top_queries = EXCLUDED.top_queries,
       rising_queries = EXCLUDED.rising_queries,
       cache_source = EXCLUDED.cache_source,
       cache_provider = EXCLUDED.cache_provider,
       cache_version = EXCLUDED.cache_version,
       retrieval_method = EXCLUDED.retrieval_method,
       confidence_score = EXCLUDED.confidence_score,
       updated_at = now()`,
    [
      cacheKey,
      geo,
      JSON.stringify(mapToObject(trends.topQueries)),
      JSON.stringify(mapToObject(trends.risingQueries)),
    ]
  );

  return trends;
}

/**
 * Scores a keyword using autocomplete rank + Google Trends data.
 */
function scoreKeyword(
  keyword: string,
  suggestions: string[],
  allSuggestions: Map<string, string[]>,
  trends: TrendsData
): KeywordMetrics {
  const kwLower = keyword.toLowerCase();

  // --- Autocomplete signal ---
  let bestRank = -1;
  let totalAppearances = 0;

  for (const [, suggs] of allSuggestions) {
    const idx = suggs.findIndex((s) => s.toLowerCase().includes(kwLower));
    if (idx !== -1) {
      totalAppearances++;
      if (bestRank === -1 || idx < bestRank) bestRank = idx;
    }
  }

  const directIdx = suggestions.findIndex((s) =>
    s.toLowerCase().includes(kwLower) || kwLower.includes(s.toLowerCase())
  );
  if (directIdx !== -1 && (bestRank === -1 || directIdx < bestRank)) {
    bestRank = directIdx;
    totalAppearances++;
  }

  // --- Trends signal ---
  // Check if this keyword (or a close match) appears in Trends data
  let trendsScore = 0;
  let isRising = false;

  // Exact or partial match in top queries
  for (const [tq, val] of trends.topQueries) {
    if (tq.includes(kwLower) || kwLower.includes(tq)) {
      trendsScore = Math.max(trendsScore, val);
    }
  }

  // Check rising queries for growth signal
  for (const [rq, val] of trends.risingQueries) {
    if (rq.includes(kwLower) || kwLower.includes(rq)) {
      isRising = true;
      trendsScore = Math.max(trendsScore, Math.min(val, 100));
    }
  }

  // --- Combined scoring ---
  let estimatedVolume: number;
  let competition: "LOW" | "MEDIUM" | "HIGH";
  let competitionIndex: number;

  if (bestRank === -1 && trendsScore === 0) {
    // No signal from either source
    estimatedVolume = Math.round(10 + Math.random() * 30);
    competition = "LOW";
    competitionIndex = Math.round(10 + Math.random() * 15);
  } else {
    // Base from autocomplete position
    let autoBase: number;
    if (bestRank === -1) {
      autoBase = 30;
    } else if (bestRank <= 2) {
      autoBase = 500 + (2 - bestRank) * 800 + totalAppearances * 200;
    } else if (bestRank <= 5) {
      autoBase = 150 + (5 - bestRank) * 100 + totalAppearances * 50;
    } else {
      autoBase = 50 + (9 - bestRank) * 20 + totalAppearances * 20;
    }

    // Boost from Trends (trendsScore is 0-100 relative interest)
    const trendsMultiplier = 1 + (trendsScore / 100) * 0.5;
    const risingBoost = isRising ? 1.3 : 1.0;

    estimatedVolume = Math.round(autoBase * trendsMultiplier * risingBoost);

    // Competition from combined signals
    if (bestRank <= 2 || trendsScore >= 60) {
      competition = "HIGH";
      competitionIndex = Math.round(55 + (trendsScore / 100) * 35);
    } else if (bestRank <= 5 || trendsScore >= 30) {
      competition = "MEDIUM";
      competitionIndex = Math.round(30 + (trendsScore / 100) * 30);
    } else {
      competition = "LOW";
      competitionIndex = Math.round(10 + (trendsScore / 100) * 25);
    }
  }

  return {
    keyword,
    avg_monthly_searches: estimatedVolume,
    competition,
    competition_index: competitionIndex,
    low_top_of_page_bid: competition === "HIGH" ? 15 : competition === "MEDIUM" ? 8 : 3,
    high_top_of_page_bid: competition === "HIGH" ? 45 : competition === "MEDIUM" ? 25 : 12,
  };
}

async function getCachedMetrics(
  keywords: string[],
  db?: DbClient,
  forceRefresh = false
): Promise<Map<string, KeywordMetrics>> {
  const metrics = new Map<string, KeywordMetrics>();
  if (!db || keywords.length === 0 || forceRefresh) {
    return metrics;
  }

  const result = await db.query<{ keyword: string; metrics: KeywordMetrics; updated_at: Date }>(
    `SELECT keyword, metrics, updated_at
     FROM keyword_metrics_cache
     WHERE keyword = ANY($1::text[])`,
    [keywords]
  );

  for (const row of result.rows) {
    if (isFreshTimestamp(row.updated_at, KEYWORD_RESEARCH_TTL_MS)) {
      metrics.set(row.keyword, row.metrics);
    }
  }

  return metrics;
}

async function persistMetrics(
  metrics: KeywordMetrics[],
  db?: DbClient
): Promise<void> {
  if (!db || metrics.length === 0) {
    return;
  }

  for (const metric of metrics) {
    await db.query(
      `INSERT INTO keyword_metrics_cache
       (keyword, metrics, cache_source, cache_provider, cache_version, retrieval_method, confidence_score, updated_at)
       VALUES ($1, $2, 'estimated', 'google-autocomplete+google-trends', 'v1', 'estimated', 0.58, now())
       ON CONFLICT (keyword) DO UPDATE SET
         metrics = EXCLUDED.metrics,
         cache_source = EXCLUDED.cache_source,
         cache_provider = EXCLUDED.cache_provider,
         cache_version = EXCLUDED.cache_version,
         retrieval_method = EXCLUDED.retrieval_method,
         confidence_score = EXCLUDED.confidence_score,
         updated_at = now()`,
      [metric.keyword, JSON.stringify(metric)]
    );
  }
}

/**
 * Creates a keyword research client using Google Autocomplete + Google Trends.
 *
 * - Autocomplete: real suggestion ranking = real search demand
 * - Trends: relative interest scores + rising queries = demand validation + growth signal
 *
 * When Google Ads API Basic access is approved, replace with the real
 * google-ads-api KeywordPlanIdeaService for exact monthly search volumes.
 */
export function createGoogleKpClient(
  db?: DbClient,
  options?: {
    forceRefresh?: boolean;
  },
  _credentials?: {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): GoogleKpClient {
  return {
    async getKeywordIdeas(keywords: string[]): Promise<KeywordMetrics[]> {
      console.log(`[GoogleKP] Fetching data for ${keywords.length} keywords...`);
      const forceRefresh = options?.forceRefresh === true;
      const cachedMetrics = await getCachedMetrics(keywords, db, forceRefresh);
      const missingKeywords = keywords.filter((keyword) => !cachedMetrics.has(keyword));

      if (missingKeywords.length === 0) {
        console.log("[GoogleKP] Reusing cached keyword metrics");
        return keywords.map((keyword) => cachedMetrics.get(keyword)!);
      }

      console.log(`[GoogleKP] Cache hit for ${cachedMetrics.size} keywords, refreshing ${missingKeywords.length}`);

      // Extract the niche from keywords (first word or two before city names)
      const nicheGuess = missingKeywords[0]?.split(/\s+/).slice(0, 2).join(" ") ?? "pest control";

      // Fetch Trends data for the niche (single request, covers all keywords)
      console.log(`[GoogleKP] Fetching Google Trends for "${nicheGuess}"...`);
      const trends = await getTrendsDataCached(nicheGuess, "US-CA", db, forceRefresh);
      console.log(
        `[GoogleKP] Trends: ${trends.topQueries.size} top queries, ${trends.risingQueries.size} rising queries`
      );

      // Deduplicate autocomplete queries
      const baseQueries = new Set<string>();
      for (const kw of missingKeywords) {
        const words = kw.split(/\s+/).slice(0, 4).join(" ");
        baseQueries.add(words.toLowerCase());
      }

      const queriesToFetch = Array.from(baseQueries).slice(0, 50);

      // Fetch autocomplete in batches
      const allSuggestions = new Map<string, string[]>();
      const BATCH_SIZE = 5;
      const DELAY_MS = 200;

      for (let i = 0; i < queriesToFetch.length; i += BATCH_SIZE) {
        const batch = queriesToFetch.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (q) => {
            const suggestions = await getAutocompleteSuggestionsCached(q, db, forceRefresh);
            return [q, suggestions] as const;
          })
        );

        for (const [q, suggs] of results) {
          allSuggestions.set(q, suggs);
        }

        if (i + BATCH_SIZE < queriesToFetch.length) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
      }

      const totalSuggestions = Array.from(allSuggestions.values()).reduce(
        (sum, s) => sum + s.length, 0
      );
      console.log(
        `[GoogleKP] Autocomplete: ${totalSuggestions} suggestions from ${allSuggestions.size} queries`
      );

      // Score each keyword using both data sources
      const refreshedMetrics = missingKeywords.map((kw) => {
        const words = kw.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        const directSuggestions = allSuggestions.get(words) ?? [];
        return scoreKeyword(kw, directSuggestions, allSuggestions, trends);
      });

      await persistMetrics(refreshedMetrics, db);
      for (const metric of refreshedMetrics) {
        cachedMetrics.set(metric.keyword, metric);
      }

      return keywords.map((kw) => cachedMetrics.get(kw)!);
    },
  };
}

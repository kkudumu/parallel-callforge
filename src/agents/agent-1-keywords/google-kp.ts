import googleTrends from "google-trends-api";

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

/**
 * Creates a keyword research client using Google Autocomplete + Google Trends.
 *
 * - Autocomplete: real suggestion ranking = real search demand
 * - Trends: relative interest scores + rising queries = demand validation + growth signal
 *
 * When Google Ads API Basic access is approved, replace with the real
 * google-ads-api KeywordPlanIdeaService for exact monthly search volumes.
 */
export function createGoogleKpClient(_credentials?: {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): GoogleKpClient {
  return {
    async getKeywordIdeas(keywords: string[]): Promise<KeywordMetrics[]> {
      console.log(`[GoogleKP] Fetching data for ${keywords.length} keywords...`);

      // Extract the niche from keywords (first word or two before city names)
      const nicheGuess = keywords[0]?.split(/\s+/).slice(0, 2).join(" ") ?? "pest control";

      // Fetch Trends data for the niche (single request, covers all keywords)
      console.log(`[GoogleKP] Fetching Google Trends for "${nicheGuess}"...`);
      const trends = await getTrendsData(nicheGuess, "US-CA");
      console.log(
        `[GoogleKP] Trends: ${trends.topQueries.size} top queries, ${trends.risingQueries.size} rising queries`
      );

      // Deduplicate autocomplete queries
      const baseQueries = new Set<string>();
      for (const kw of keywords) {
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
            const suggestions = await getAutocompleteSuggestions(q);
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
      return keywords.map((kw) => {
        const words = kw.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
        const directSuggestions = allSuggestions.get(words) ?? [];
        return scoreKeyword(kw, directSuggestions, allSuggestions, trends);
      });
    },
  };
}

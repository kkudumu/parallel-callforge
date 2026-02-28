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

// Real implementation requires google-ads-api package and credentials.
// This stub returns LLM-estimated data for MVP.
export function createGoogleKpClient(_credentials?: {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): GoogleKpClient {
  return {
    async getKeywordIdeas(keywords: string[]): Promise<KeywordMetrics[]> {
      console.warn("[GoogleKP] Using stub - returning empty results. Set up Google Ads API for real data.");
      return keywords.map((kw) => ({
        keyword: kw,
        avg_monthly_searches: 0,
        competition: "LOW" as const,
        competition_index: 0,
        low_top_of_page_bid: 0,
        high_top_of_page_bid: 0,
      }));
    },
  };
}

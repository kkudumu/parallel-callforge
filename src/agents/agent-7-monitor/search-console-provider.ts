import type { DbClient } from "../../shared/db/client.js";
import { generateMockMetrics, type MockPageMetrics } from "./mock-data.js";

interface SearchConsoleDataProviderContract {
  getMetrics(
    pageId: string,
    url: string,
    city: string,
    daysSincePublish: number
  ): Promise<MockPageMetrics>;
}

/**
 * Placeholder for the future Google Search Console / URL Inspection-backed
 * provider. Until that integration exists, this class routes through the
 * existing database-backed provider so the call site is stable.
 */
export class SearchConsoleDataProvider implements SearchConsoleDataProviderContract {
  private hasWarned = false;

  constructor(private readonly db: DbClient) {}

  async getMetrics(
    pageId: string,
    url: string,
    city: string,
    daysSincePublish: number
  ): Promise<MockPageMetrics> {
    if (!this.hasWarned) {
      this.hasWarned = true;
      console.warn(
        "[Agent 7] Search Console provider stub active; falling back to database-backed metrics"
      );
    }

    const [performanceResult, rankingResult] = await Promise.all([
      this.db.query<{
        sessions: number;
        bounce_rate: number | null;
        avg_session_duration: number | null;
        click_to_call_count: number;
        calls_total: number;
        calls_qualified: number;
      }>(
        `SELECT sessions, bounce_rate, avg_session_duration, click_to_call_count, calls_total, calls_qualified
         FROM performance_snapshots
         WHERE page_id = $1
         ORDER BY snapshot_date DESC
         LIMIT 1`,
        [pageId]
      ),
      this.db.query<{
        clicks: number;
        impressions: number;
        position: number | null;
      }>(
        `SELECT clicks, impressions, position
         FROM ranking_snapshots
         WHERE page_id = $1
         ORDER BY snapshot_date DESC
         LIMIT 1`,
        [pageId]
      ),
    ]);

    const perf = performanceResult.rows[0];
    const ranking = rankingResult.rows[0];

    if (!perf && !ranking) {
      return generateMockMetrics(pageId, url, city, daysSincePublish);
    }

    const callsTotal = Math.max(0, perf?.calls_total ?? 0);
    const clickToCallCount = Math.max(0, perf?.click_to_call_count ?? 0);

    return {
      pageId,
      url,
      city,
      daysSincePublish,
      isIndexed: Boolean(ranking),
      position: ranking?.position ?? 45,
      impressions: Math.max(0, ranking?.impressions ?? perf?.sessions ?? 0),
      clicks: Math.max(0, ranking?.clicks ?? perf?.sessions ?? 0),
      bounceRate: perf?.bounce_rate ?? 0.55,
      avgSessionDuration: perf?.avg_session_duration ?? 90,
      clickToCallRate: callsTotal > 0
        ? Math.min(1, clickToCallCount / callsTotal)
        : perf && perf.sessions > 0
          ? Math.min(1, clickToCallCount / perf.sessions)
          : 0.08,
      callQualificationRate: callsTotal > 0
        ? Math.min(1, (perf?.calls_qualified ?? 0) / callsTotal)
        : 0.4,
    };
  }
}

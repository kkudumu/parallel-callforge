import { SEASONAL_INDEX } from "./thresholds.js";

export interface MockPageMetrics {
  pageId: string;
  url: string;
  city: string;
  daysSincePublish: number;
  bounceRate: number;
  clickToCallRate: number;
  callQualificationRate: number;
  avgSessionDuration: number;
  impressions: number;
  clicks: number;
  position: number;
  isIndexed: boolean;
}

// Simulate Google sandbox progression: pages start poorly and improve over ~90 days
function sandboxFactor(daysSincePublish: number): number {
  if (daysSincePublish < 14) return 0.1;
  if (daysSincePublish < 30) return 0.3;
  if (daysSincePublish < 60) return 0.5;
  if (daysSincePublish < 90) return 0.7;
  return 0.9;
}

function jitter(base: number, range: number): number {
  return base + (Math.random() - 0.5) * range * 2;
}

export function generateMockMetrics(
  pageId: string,
  url: string,
  city: string,
  daysSincePublish: number,
  month: number = new Date().getMonth() + 1
): MockPageMetrics {
  const sf = sandboxFactor(daysSincePublish);
  const seasonal = SEASONAL_INDEX[month] ?? 1.0;

  const isIndexed = daysSincePublish > 7 || Math.random() > 0.5;
  const position = isIndexed
    ? Math.max(1, Math.round(jitter(50 - sf * 45, 5)))
    : 100;

  const baseImpressions = Math.round(sf * seasonal * jitter(200, 80));
  const impressions = isIndexed ? Math.max(0, baseImpressions) : 0;
  const ctr = isIndexed ? Math.max(0.005, jitter(0.03 * sf, 0.01)) : 0;
  const clicks = Math.round(impressions * ctr);

  return {
    pageId,
    url,
    city,
    daysSincePublish,
    bounceRate: Math.max(0.15, Math.min(0.85, jitter(0.65 - sf * 0.25, 0.08))),
    clickToCallRate: Math.max(0, Math.min(0.25, jitter(sf * 0.08, 0.02))),
    callQualificationRate: Math.max(0.1, Math.min(0.9, jitter(0.35 + sf * 0.25, 0.1))),
    avgSessionDuration: Math.max(10, Math.round(jitter(40 + sf * 100, 20))),
    impressions,
    clicks,
    position,
    isIndexed,
  };
}

export function generatePortfolioMockData(
  pages: Array<{ id: string; url: string; city: string; publishedDaysAgo: number }>,
  month?: number
): MockPageMetrics[] {
  return pages.map((p) =>
    generateMockMetrics(p.id, p.url, p.city, p.publishedDaysAgo, month)
  );
}

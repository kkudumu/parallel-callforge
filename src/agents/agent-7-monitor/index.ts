import type { DbClient } from "../../shared/db/client.js";
import { evaluateThresholds, type MetricsInput, type Severity } from "./thresholds.js";
import { calculateHealthScore, interpretScore, type HealthScoreInput } from "./health-score.js";
import { generateMockMetrics, type MockPageMetrics } from "./mock-data.js";
import { eventBus } from "../../shared/events/event-bus.js";

export interface DataProvider {
  getMetrics(pageId: string, url: string, city: string, daysSincePublish: number): MockPageMetrics;
}

export class MockDataProvider implements DataProvider {
  getMetrics(pageId: string, url: string, city: string, daysSincePublish: number): MockPageMetrics {
    return generateMockMetrics(pageId, url, city, daysSincePublish);
  }
}

export interface Agent7Config {
  niche: string;
}

interface PageRow {
  id: string;
  url: string;
  city: string;
  published_at: string;
}

// 5-stage rebalancing decision tree per PRD
function determineOptimizationAction(
  severity: Severity,
  metricName: string,
  daysSincePublish: number
): { action_type: string; target_agent: string; trigger_reason: string } | null {
  if (severity === "good") return null;

  // Stage 1: Too early — wait for Google sandbox (< 30 days)
  if (daysSincePublish < 30) {
    return null;
  }

  // Stage 2: Content quality issues (bounce rate, session duration)
  if (metricName === "bounceRate" || metricName === "avgSessionDuration") {
    return {
      action_type: "content_refresh",
      target_agent: "agent-3",
      trigger_reason: `${metricName} at ${severity} level after ${daysSincePublish} days`,
    };
  }

  // Stage 3: Conversion issues (click-to-call rate)
  if (metricName === "clickToCallRate") {
    return {
      action_type: "cta_optimization",
      target_agent: "agent-3",
      trigger_reason: `Low click-to-call rate at ${severity} level`,
    };
  }

  // Stage 4: Call quality issues
  if (metricName === "callQualificationRate") {
    return {
      action_type: "keyword_refinement",
      target_agent: "agent-1",
      trigger_reason: `Low call qualification rate — may indicate keyword-intent mismatch`,
    };
  }

  return null;
}

export async function runAgent7(
  config: Agent7Config,
  db: DbClient,
  dataProvider: DataProvider = new MockDataProvider()
): Promise<void> {
  console.log(`[Agent 7] Starting performance monitor for ${config.niche}`);
  eventBus.emitEvent({ type: "agent_step", agent: "agent-7", step: "Starting", detail: config.niche, timestamp: Date.now() });

  // Fetch all active pages
  const pagesResult = await db.query(
    "SELECT id, url, city, published_at FROM pages WHERE niche = $1",
    [config.niche]
  );

  if (pagesResult.rows.length === 0) {
    console.log("[Agent 7] No pages found. Run Agents 1-3 first.");
    return;
  }

  const pages = pagesResult.rows as PageRow[];
  const now = Date.now();
  let totalIndexed = 0;
  let totalRanking = 0;
  let totalConversion = 0;
  let totalCallQuality = 0;
  let totalTraffic = 0;
  let totalRevenue = 0;
  let criticalAlerts = 0;

  for (const page of pages) {
    const daysSincePublish = Math.floor(
      (now - new Date(page.published_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    const metrics = dataProvider.getMetrics(page.id, page.url, page.city, daysSincePublish);
    console.log(
      `[Agent 7] ${page.city}: indexed=${metrics.isIndexed} pos=${metrics.position.toFixed(1)} ctr=${(metrics.clickToCallRate * 100).toFixed(1)}% quality=${(metrics.callQualificationRate * 100).toFixed(1)}%`
    );

    // Store performance snapshot
    await db.query(
      `INSERT INTO performance_snapshots
         (page_id, snapshot_date, sessions, bounce_rate, avg_session_duration, click_to_call_rate, call_count, qualified_call_count, revenue)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        page.id,
        metrics.impressions,
        metrics.bounceRate,
        metrics.avgSessionDuration,
        metrics.clickToCallRate,
        metrics.clicks,
        Math.round(metrics.clicks * metrics.callQualificationRate),
        metrics.clicks * metrics.callQualificationRate * 85, // ~$85 avg payout
      ]
    );

    // Store ranking snapshot
    if (metrics.isIndexed) {
      await db.query(
        `INSERT INTO ranking_snapshots (page_id, snapshot_date, query, device, clicks, impressions, ctr, position)
         VALUES ($1, CURRENT_DATE, $2, 'MOBILE', $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          page.id,
          `${page.city} pest control`,
          metrics.clicks,
          metrics.impressions,
          metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0,
          metrics.position,
        ]
      );
    }

    // Evaluate thresholds
    const thresholds = evaluateThresholds({
      bounceRate: metrics.bounceRate,
      clickToCallRate: metrics.clickToCallRate,
      callQualificationRate: metrics.callQualificationRate,
      avgSessionDuration: metrics.avgSessionDuration,
    });

    // Generate alerts for threshold violations
    const metricEntries: Array<[string, { severity: Severity; value: number; threshold: { good: number; warning: number; critical: number } }]> = [
      ["bounceRate", thresholds.bounceRate],
      ["clickToCallRate", thresholds.clickToCallRate],
      ["callQualificationRate", thresholds.callQualificationRate],
      ["avgSessionDuration", thresholds.avgSessionDuration],
    ];

    for (const [metricName, check] of metricEntries) {
      if (check.severity === "good") continue;

      if (check.severity === "critical") criticalAlerts++;

      // Insert alert
      const alertResult = await db.query(
        `INSERT INTO alerts (page_id, alert_type, severity, message, metric_name, threshold_value, actual_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          page.id,
          `threshold_${metricName}`,
          check.severity,
          `${metricName} is at ${check.severity} level (${check.value.toFixed(3)})`,
          metricName,
          check.severity === "warning"
            ? check.threshold.warning
            : check.threshold.critical,
          check.value,
        ]
      );

      // Generate optimization action
      const action = determineOptimizationAction(check.severity, metricName, daysSincePublish);
      if (action) {
        console.log(
          `[Agent 7] Action queued for ${page.city}: ${action.action_type} -> ${action.target_agent} (${metricName})`
        );
        await db.query(
          `INSERT INTO optimization_actions (page_id, alert_id, action_type, target_agent, trigger_reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            page.id,
            alertResult.rows[0].id,
            action.action_type,
            action.target_agent,
            action.trigger_reason,
          ]
        );
      }
    }

    // Accumulate portfolio stats
    if (metrics.isIndexed) totalIndexed++;
    if (metrics.position <= 20) totalRanking++;
    totalConversion += metrics.clickToCallRate;
    totalCallQuality += metrics.callQualificationRate;
    totalTraffic += metrics.impressions;
    totalRevenue += metrics.clicks * metrics.callQualificationRate * 85;
  }

  // Calculate portfolio health score
  const healthInput: HealthScoreInput = {
    indexingRate: pages.length > 0 ? totalIndexed / pages.length : 0,
    rankingProgress: pages.length > 0 ? totalRanking / pages.length : 0,
    trafficTrend: Math.min(totalTraffic / (pages.length * 200), 1.0),
    conversionRate: pages.length > 0 ? totalConversion / pages.length : 0,
    callQualityRate: pages.length > 0 ? totalCallQuality / pages.length : 0,
    revenueTrend: Math.min(totalRevenue / (pages.length * 1000), 1.0),
    criticalAlerts,
  };

  const healthScore = calculateHealthScore(healthInput);
  const interpretation = interpretScore(healthScore);

  console.log(`[Agent 7] Portfolio Health Score: ${healthScore}/100 — ${interpretation}`);
  console.log(`[Agent 7] Pages: ${pages.length} total, ${totalIndexed} indexed, ${totalRanking} ranking top-20`);
  console.log(`[Agent 7] Critical alerts: ${criticalAlerts}`);
  console.log("[Agent 7] Performance monitoring complete");

  eventBus.emitEvent({
    type: "health_score",
    score: healthScore,
    interpretation,
    indexedPages: totalIndexed,
    totalPages: pages.length,
    criticalAlerts,
    timestamp: Date.now(),
  });
  eventBus.emitEvent({ type: "agent_step", agent: "agent-7", step: "Complete", detail: `Score: ${healthScore}/100`, timestamp: Date.now() });
}

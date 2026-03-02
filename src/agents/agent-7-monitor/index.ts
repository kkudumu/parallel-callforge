import type { DbClient } from "../../shared/db/client.js";
import { evaluateThresholds, type MetricsInput, type Severity } from "./thresholds.js";
import { calculateHealthScore, interpretScore, type HealthScoreInput } from "./health-score.js";
import { generateMockMetrics, type MockPageMetrics } from "./mock-data.js";
import { eventBus } from "../../shared/events/event-bus.js";
import {
  buildCheckpointScope,
  createCheckpointTracker,
} from "../../shared/checkpoints.js";

export interface DataProvider {
  getMetrics(pageId: string, url: string, city: string, daysSincePublish: number): Promise<MockPageMetrics>;
}

export class MockDataProvider implements DataProvider {
  async getMetrics(pageId: string, url: string, city: string, daysSincePublish: number): Promise<MockPageMetrics> {
    return generateMockMetrics(pageId, url, city, daysSincePublish);
  }
}

export class DatabaseBackedDataProvider implements DataProvider {
  constructor(private readonly db: DbClient) {}

  async getMetrics(
    pageId: string,
    url: string,
    city: string,
    daysSincePublish: number
  ): Promise<MockPageMetrics> {
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
        ctr: number | null;
        position: number | null;
      }>(
        `SELECT clicks, impressions, ctr, position
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

export interface Agent7Config {
  niche: string;
}

interface PageRow {
  id: string;
  url: string;
  slug: string;
  city: string;
  state: string;
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
  dataProvider: DataProvider = new DatabaseBackedDataProvider(db)
): Promise<void> {
  console.log(`[Agent 7] Starting performance monitor for ${config.niche}`);
  eventBus.emitEvent({ type: "agent_step", agent: "agent-7", step: "Starting", detail: config.niche, timestamp: Date.now() });

  // Fetch all active pages
  const pagesResult = await db.query(
    "SELECT id, url, slug, city, state, published_at FROM pages WHERE niche = $1",
    [config.niche]
  );

  if (pagesResult.rows.length === 0) {
    console.log("[Agent 7] No pages found. Run Agents 1-3 first.");
    return;
  }

  const pages = pagesResult.rows as PageRow[];
  const checkpointScope = buildCheckpointScope([
    config.niche,
    new Date().toISOString().slice(0, 10),
    pages.map((page) => page.id).sort(),
  ]);
  const checkpoints = await createCheckpointTracker(db, "agent-7", checkpointScope);
  if (checkpoints.has("completed")) {
    console.log(`[Agent 7] Reusing completed checkpoint for ${config.niche}`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-7", step: "Checkpoint hit", detail: "Completed", timestamp: Date.now() });
    return;
  }
  const now = Date.now();
  let totalIndexed = 0;
  let totalRanking = 0;
  let totalConversion = 0;
  let totalCallQuality = 0;
  let totalTraffic = 0;
  let totalRevenue = 0;
  let criticalAlerts = 0;

  for (const [index, page] of pages.entries()) {
    console.log(
      `[Agent 7] Processing page ${index + 1}/${pages.length}: ${page.city}, ${page.state} (${page.slug})`
    );
    const daysSincePublish = Math.floor(
      (now - new Date(page.published_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    const metrics = await dataProvider.getMetrics(page.id, page.url, page.city, daysSincePublish);
    const sessions = metrics.clicks;
    const users = Math.max(0, Math.round(metrics.clicks * 0.9));
    const pageviews = Math.max(sessions, Math.round(metrics.clicks * 1.15));
    const organicSessions = sessions;
    const clickToCallCount = Math.max(
      0,
      Math.round(metrics.clicks * metrics.clickToCallRate)
    );
    const callsTotal = clickToCallCount;
    const callsQualified = Math.max(
      0,
      Math.round(callsTotal * metrics.callQualificationRate)
    );
    const estimatedRevenue = callsQualified * 85;
    console.log(
      `[Agent 7] ${page.city}: indexed=${metrics.isIndexed} pos=${metrics.position.toFixed(1)} ctr=${(metrics.clickToCallRate * 100).toFixed(1)}% quality=${(metrics.callQualificationRate * 100).toFixed(1)}%`
    );

    // Store performance snapshot
    await db.query(
      `INSERT INTO performance_snapshots
         (page_id, snapshot_date, sessions, users, pageviews, organic_sessions, bounce_rate, avg_session_duration, click_to_call_count, calls_total, calls_qualified, revenue)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (page_id, snapshot_date) DO UPDATE SET
         sessions = EXCLUDED.sessions,
         users = EXCLUDED.users,
         pageviews = EXCLUDED.pageviews,
         organic_sessions = EXCLUDED.organic_sessions,
         bounce_rate = EXCLUDED.bounce_rate,
         avg_session_duration = EXCLUDED.avg_session_duration,
         click_to_call_count = EXCLUDED.click_to_call_count,
         calls_total = EXCLUDED.calls_total,
         calls_qualified = EXCLUDED.calls_qualified,
         revenue = EXCLUDED.revenue`,
      [
        page.id,
        sessions,
        users,
        pageviews,
        organicSessions,
        metrics.bounceRate,
        metrics.avgSessionDuration,
        clickToCallCount,
        callsTotal,
        callsQualified,
        estimatedRevenue,
      ]
    );

    // Store ranking snapshot
    if (metrics.isIndexed) {
      await db.query(
        `UPDATE pages
         SET indexation_status = 'indexed'
         WHERE id = $1`,
        [page.id]
      );
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
    } else {
      await db.query(
        `UPDATE pages
         SET indexation_status = $2
         WHERE id = $1`,
        [page.id, daysSincePublish >= 21 ? "not_indexed" : "pending"]
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
        const actionResult = await db.query(
          `INSERT INTO optimization_actions (page_id, alert_id, action_type, target_agent, trigger_reason)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            page.id,
            alertResult.rows[0].id,
            action.action_type,
            action.target_agent,
            action.trigger_reason,
          ]
        );

        const taskPayload = {
          page_id: page.id,
          page_slug: page.slug,
          city: page.city,
          state: page.state,
          niche: config.niche,
          optimizationActionId: actionResult.rows[0].id,
          forceRefresh: action.target_agent === "agent-1",
          triggerReason: action.trigger_reason,
        };
        const existingTask = await db.query<{ id: string }>(
          `SELECT id
           FROM agent_tasks
           WHERE task_type = $1
             AND agent_name = $2
             AND status IN ('pending', 'running')
             AND payload->>'page_id' = $3
           LIMIT 1`,
          [action.action_type, action.target_agent, page.id]
        );
        if (existingTask.rows.length === 0) {
          await db.query(
            `INSERT INTO agent_tasks (task_type, agent_name, payload)
             VALUES ($1, $2, $3)`,
            [action.action_type, action.target_agent, JSON.stringify(taskPayload)]
          );
        }
      }
    }

    // Accumulate portfolio stats
    if (metrics.isIndexed) totalIndexed++;
    if (metrics.position <= 20) totalRanking++;
    totalConversion += metrics.clickToCallRate;
    totalCallQuality += metrics.callQualificationRate;
    totalTraffic += organicSessions;
    totalRevenue += estimatedRevenue;
    console.log(
      `[Agent 7] Progress ${index + 1}/${pages.length}: indexed=${totalIndexed} ranking=${totalRanking} alerts=${criticalAlerts} revenue=$${totalRevenue}`
    );
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
  await checkpoints.mark("completed", {
    totalPages: pages.length,
  });

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

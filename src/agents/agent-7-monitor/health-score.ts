export interface HealthScoreInput {
  indexingRate: number;      // 0-1, fraction of pages indexed
  rankingProgress: number;   // 0-1, fraction of pages ranking
  trafficTrend: number;      // 0-1, normalized traffic growth
  conversionRate: number;    // 0-1, click-to-call rate
  callQualityRate: number;   // 0-1, call qualification rate
  revenueTrend: number;      // 0-1, normalized revenue growth
  criticalAlerts: number;    // count of unresolved critical alerts
}

const WEIGHTS = {
  indexing: 0.10,
  ranking: 0.20,
  traffic: 0.15,
  conversion: 0.20,
  callQuality: 0.10,
  revenue: 0.20,
  alertBurden: 0.05,
};

const BENCHMARKS = {
  conversionRate: 0.08,
  callQualityRate: 0.55,
};

export function calculateHealthScore(input: HealthScoreInput): number {
  const conversionScore = Math.min(input.conversionRate / BENCHMARKS.conversionRate, 1.0);
  const callQualityScore = Math.min(input.callQualityRate / BENCHMARKS.callQualityRate, 1.0);
  const alertScore = Math.max(0, 1 - input.criticalAlerts * 0.2);

  const weighted =
    input.indexingRate * WEIGHTS.indexing +
    input.rankingProgress * WEIGHTS.ranking +
    input.trafficTrend * WEIGHTS.traffic +
    conversionScore * WEIGHTS.conversion +
    callQualityScore * WEIGHTS.callQuality +
    input.revenueTrend * WEIGHTS.revenue +
    alertScore * WEIGHTS.alertBurden;

  return Math.round(weighted * 100);
}

export function interpretScore(score: number): string {
  if (score >= 80) return "Thriving";
  if (score >= 60) return "Healthy with areas to improve";
  if (score >= 40) return "Needs attention";
  return "Critical intervention required";
}

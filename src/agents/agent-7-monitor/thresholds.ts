export type Severity = "good" | "warning" | "critical";

export interface ThresholdCheck {
  severity: Severity;
  value: number;
  threshold: { good: number; warning: number; critical: number };
}

export interface ThresholdResult {
  bounceRate: ThresholdCheck;
  clickToCallRate: ThresholdCheck;
  callQualificationRate: ThresholdCheck;
  avgSessionDuration: ThresholdCheck;
}

export interface MetricsInput {
  bounceRate: number;
  clickToCallRate: number;
  callQualificationRate: number;
  avgSessionDuration: number;
}

function checkLowerIsBetter(value: number, good: number, warning: number, critical: number): ThresholdCheck {
  const severity: Severity =
    value <= good ? "good" : value <= warning ? "warning" : "critical";
  return { severity, value, threshold: { good, warning, critical } };
}

function checkHigherIsBetter(value: number, good: number, warning: number, critical: number): ThresholdCheck {
  const severity: Severity =
    value >= good ? "good" : value >= warning ? "warning" : "critical";
  return { severity, value, threshold: { good, warning, critical } };
}

export function evaluateThresholds(metrics: MetricsInput): ThresholdResult {
  return {
    bounceRate: checkLowerIsBetter(metrics.bounceRate, 0.40, 0.55, 0.65),
    clickToCallRate: checkHigherIsBetter(metrics.clickToCallRate, 0.08, 0.05, 0.03),
    callQualificationRate: checkHigherIsBetter(metrics.callQualificationRate, 0.55, 0.40, 0.30),
    avgSessionDuration: checkHigherIsBetter(metrics.avgSessionDuration, 120, 60, 30),
  };
}

export const EXPECTED_CTR_BY_POSITION: Record<number, { expected: number; alert: number }> = {
  1: { expected: 0.215, alert: 0.13 },
  2: { expected: 0.135, alert: 0.08 },
  3: { expected: 0.09, alert: 0.06 },
  4: { expected: 0.06, alert: 0.04 },
  5: { expected: 0.045, alert: 0.03 },
  6: { expected: 0.03, alert: 0.015 },
  7: { expected: 0.03, alert: 0.015 },
  8: { expected: 0.025, alert: 0.015 },
  9: { expected: 0.02, alert: 0.015 },
  10: { expected: 0.02, alert: 0.015 },
};

export const SEASONAL_INDEX: Record<number, number> = {
  1: 0.60, 2: 0.65, 3: 0.90, 4: 1.15, 5: 1.30, 6: 1.40,
  7: 1.45, 8: 1.35, 9: 1.10, 10: 0.90, 11: 0.70, 12: 0.55,
};

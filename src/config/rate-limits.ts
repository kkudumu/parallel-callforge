export interface ProviderRateLimitConfig {
  maxConcurrent: number;
  minTime: number;
  reservoir: number;
  reservoirRefreshAmount: number;
  reservoirRefreshInterval: number;
}

export const RATE_LIMITS: Record<string, ProviderRateLimitConfig> = {
  claude: {
    maxConcurrent: 2,
    minTime: 15_000,
    reservoir: 40,
    reservoirRefreshAmount: 40,
    reservoirRefreshInterval: 24 * 60 * 60 * 1000,
  },
  codex: {
    maxConcurrent: 2,
    minTime: 15_000,
    reservoir: 40,
    reservoirRefreshAmount: 40,
    reservoirRefreshInterval: 24 * 60 * 60 * 1000,
  },
  gemini: {
    maxConcurrent: 2,
    minTime: 15_000,
    reservoir: 40,
    reservoirRefreshAmount: 40,
    reservoirRefreshInterval: 24 * 60 * 60 * 1000,
  },
  contentDeploy: {
    maxConcurrent: 1,
    minTime: 60_000,
    reservoir: 3,
    reservoirRefreshAmount: 3,
    reservoirRefreshInterval: 7 * 24 * 60 * 60 * 1000,
  },
};

export const CIRCUIT_BREAKER_OPTIONS = {
  timeout: 120_000,
  errorThresholdPercentage: 50,
  resetTimeout: 60_000,
  volumeThreshold: 3,
};

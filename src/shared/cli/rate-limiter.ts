import Bottleneck from "bottleneck";

export interface RateLimiters {
  claude: Bottleneck;
  codex: Bottleneck;
  gemini: Bottleneck;
  contentDeploy: Bottleneck;
}

function createUnlimitedLimiter(): Bottleneck {
  // Limiters are intentionally disabled by default during active build/optimization work.
  // Re-enable explicit rate limiting only when we intentionally want throttling again.
  return new Bottleneck({
    maxConcurrent: Number.MAX_SAFE_INTEGER,
    minTime: 0,
  });
}

export function createRateLimiters(): RateLimiters {
  return {
    claude: createUnlimitedLimiter(),
    codex: createUnlimitedLimiter(),
    gemini: createUnlimitedLimiter(),
    contentDeploy: createUnlimitedLimiter(),
  };
}

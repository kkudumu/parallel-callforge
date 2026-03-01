import Bottleneck from "bottleneck";
import { RATE_LIMITS } from "../../config/rate-limits.js";

export interface RateLimiters {
  claude: Bottleneck;
  codex: Bottleneck;
  gemini: Bottleneck;
  contentDeploy: Bottleneck;
}

export function createRateLimiters(): RateLimiters {
  return {
    claude: new Bottleneck(RATE_LIMITS.claude),
    codex: new Bottleneck(RATE_LIMITS.codex),
    gemini: new Bottleneck(RATE_LIMITS.gemini),
    contentDeploy: new Bottleneck(RATE_LIMITS.contentDeploy),
  };
}

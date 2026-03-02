import { createDefaultStrategy } from "../verticals/default/strategy.js";
import { createPestControlStrategy } from "../verticals/pest-control/strategy.js";
import type { VerticalStrategy } from "../verticals/types.js";

export type {
  VerticalStrategy,
  VerticalStrategyContext,
} from "../verticals/types.js";

export function resolveVerticalStrategy(verticalKey?: string | null): VerticalStrategy {
  switch (verticalKey) {
    case "pest-control":
      return createPestControlStrategy();
    case "hvac":
      return createDefaultStrategy("hvac");
    case "roofing":
      return createDefaultStrategy("roofing");
    default:
      return createDefaultStrategy(verticalKey ?? "default");
  }
}

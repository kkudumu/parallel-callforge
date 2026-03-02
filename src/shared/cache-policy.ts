import { createHash } from "node:crypto";

export const KEYWORD_RESEARCH_TTL_DAYS = 7;
export const DESIGN_RESEARCH_TTL_DAYS = 120;

export const KEYWORD_RESEARCH_TTL_MS =
  KEYWORD_RESEARCH_TTL_DAYS * 24 * 60 * 60 * 1000;
export const DESIGN_RESEARCH_TTL_MS =
  DESIGN_RESEARCH_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface CandidateCity {
  city: string;
  state: string;
  population: number;
  market_type?: string;
  cluster?: {
    id: string;
    population: number;
    city_count: number;
    anchor_city: string;
    anchor_state: string;
    anchor_population: number;
    distance_miles?: number | null;
  } | null;
  metro_parent?: {
    city: string;
    state: string;
    population: number;
    distance_miles?: number | null;
  } | null;
}

export interface ScoredCity extends CandidateCity {
  priority_score: number;
  reasoning?: string;
}

export function normalizeNiche(niche: string): string {
  return niche.trim().toLowerCase();
}

export function isFreshTimestamp(
  value: unknown,
  ttlMs: number,
  now = Date.now(),
): boolean {
  if (!value) {
    return false;
  }

  const timestamp =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string" || typeof value === "number"
        ? new Date(value).getTime()
        : Number.NaN;

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return now - timestamp <= ttlMs;
}

export function normalizeCandidateCities(cities: CandidateCity[]): CandidateCity[] {
  return [...cities]
    .map((city) => ({
      city: city.city.trim(),
      state: city.state.trim(),
      population: city.population,
      market_type: city.market_type?.trim(),
      cluster: city.cluster
        ? {
            id: city.cluster.id.trim(),
            population: city.cluster.population,
            city_count: city.cluster.city_count,
            anchor_city: city.cluster.anchor_city.trim(),
            anchor_state: city.cluster.anchor_state.trim(),
            anchor_population: city.cluster.anchor_population,
            distance_miles: city.cluster.distance_miles ?? null,
          }
        : null,
      metro_parent: city.metro_parent
        ? {
            city: city.metro_parent.city.trim(),
            state: city.metro_parent.state.trim(),
            population: city.metro_parent.population,
            distance_miles: city.metro_parent.distance_miles ?? null,
          }
        : null,
    }))
    .sort((a, b) =>
      `${a.state}|${a.city}`.localeCompare(`${b.state}|${b.city}`)
    );
}

export function computeCacheFingerprint(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

export function getCityScoringFingerprint(
  candidateCities: CandidateCity[],
  templates: string[],
): string {
  return computeCacheFingerprint({
    candidateCities: normalizeCandidateCities(candidateCities),
    templates: [...templates],
  });
}

export function getCityResearchFingerprint(
  niche: string,
  city: string,
  state: string,
  templates: string[],
): string {
  return computeCacheFingerprint({
    niche: normalizeNiche(niche),
    city: city.trim().toLowerCase(),
    state: state.trim().toLowerCase(),
    templates: [...templates],
  });
}

export function selectTopCities(scoredCities: ScoredCity[]): ScoredCity[] {
  return [...scoredCities]
    .filter((city) => city.priority_score > 50)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 5);
}

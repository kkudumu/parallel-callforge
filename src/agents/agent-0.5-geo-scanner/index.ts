import type { DbClient } from "../../shared/db/client.js";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import { eventBus } from "../../shared/events/event-bus.js";
import {
  buildCheckpointScope,
  createCheckpointTracker,
} from "../../shared/checkpoints.js";
import { importGeoZipReferenceIntoDb } from "../../shared/db/import-geo-zip-reference.js";
import { syncOfferGeoCoverageFromProfile } from "../../shared/offer-profiles.js";
import { withSelfHealing } from "../../shared/self-healing.js";

export interface GeoZipReferenceRow {
  zip_code: string;
  city: string;
  state: string;
  county: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  population_estimate: number | null;
}

interface CityZipCountRow {
  city: string;
  state: string;
  total_zip_count: number;
}

export interface CityCoverageCluster {
  city: string;
  state: string;
  zipCodes: string[];
  eligibleZipCount: number;
  population: number;
  totalCityZipCount: number;
  densityRatio: number;
  avgDistanceMiles: number;
  counties: string[];
  centroidLatitude: number | null;
  centroidLongitude: number | null;
}

export type MarketType = "standalone_city" | "suburb" | "metro_parent" | "secondary";

export interface RankedDeploymentCandidate extends CityCoverageCluster {
  preKeywordScore: number;
  coverageScore: number;
  populationScore: number;
  densityScore: number;
  spreadPenalty: number;
  deploymentFitScore: number;
  pestPressureScore: number;
  searchIdentityConfidence: number;
  missingZipCount: number;
  clusterId: string;
  clusterPopulation: number;
  clusterCityCount: number;
  clusterAnchor: {
    city: string;
    state: string;
    population: number;
  };
  clusterDistanceMiles: number | null;
  marketType: MarketType;
  metroParent: {
    city: string;
    state: string;
    population: number;
    distanceMiles: number | null;
  } | null;
  reasonSummary: string;
}

export interface Agent05Config {
  offerId: string;
  zipCodes?: string[];
  source?: string;
  topN?: number;
  autoRefreshGeoReference?: boolean;
  geoReferenceRefreshMode?: "prompt" | "script";
  missingZipCountThreshold?: number;
  missingZipRatioThreshold?: number;
  runId?: string;
  llm?: LlmClient;
}

const TARGET_POPULATION_MIN = 50_000;
const TARGET_POPULATION_MAX = 300_000;
const SUBURB_POPULATION_MIN = 25_000;
const SUBURB_POPULATION_MAX = 100_000;
const METRO_PARENT_POPULATION_MIN = 500_000;
const CLUSTER_RADIUS_MILES = 30;
const DEFAULT_MISSING_ZIP_COUNT_THRESHOLD = 25;
const DEFAULT_MISSING_ZIP_RATIO_THRESHOLD = 0.05;
const MIN_EXPECTED_GEO_REFERENCE_ROWS = 30_000;

const HIGH_PEST_PRESSURE_STATES = new Set([
  "FL", "TX", "LA", "MS", "AL", "GA", "SC", "NC", "AZ", "NV", "CA",
]);
const MODERATE_PEST_PRESSURE_STATES = new Set([
  "TN", "OK", "AR", "VA", "MD", "DC", "DE", "NM", "UT", "CO", "KS", "MO", "OR", "WA",
]);

interface GeoReferenceRefreshOutcome {
  triggered: boolean;
  mode: "prompt" | "script";
  reason: string;
  prompt?: string;
  scriptAttempted?: boolean;
  scriptSucceeded?: boolean;
}

export function normalizeZip(input: string): string | null {
  const trimmed = input.trim();
  const zip4Match = trimmed.match(/^(\d{5})-\d{4}$/);
  if (zip4Match) {
    return zip4Match[1];
  }

  const compact = trimmed.replace(/\s+/g, "");
  if (/^\d{5}$/.test(compact)) {
    return compact;
  }

  if (/^\d{9}$/.test(compact)) {
    return compact.slice(0, 5);
  }

  return null;
}

export function parseZipInput(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return normalizeZipList(input);
  }

  return normalizeZipList(
    input
      .split(/[\s,;]+/g)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
}

export function normalizeZipList(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const zip = normalizeZip(value);
    if (!zip || seen.has(zip)) {
      continue;
    }
    seen.add(zip);
    normalized.push(zip);
  }

  return normalized;
}

function toNumber(value: number | string | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampScore(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function estimatePestPressureScore(cluster: CityCoverageCluster): number {
  let score = 40;

  if (HIGH_PEST_PRESSURE_STATES.has(cluster.state)) {
    score = 85;
  } else if (MODERATE_PEST_PRESSURE_STATES.has(cluster.state)) {
    score = 65;
  }

  if (cluster.centroidLatitude !== null) {
    if (cluster.centroidLatitude < 31) {
      score += 10;
    } else if (cluster.centroidLatitude < 36) {
      score += 5;
    } else if (cluster.centroidLatitude > 43) {
      score -= 10;
    } else if (cluster.centroidLatitude > 39) {
      score -= 5;
    }
  }

  if (cluster.densityRatio >= 0.75) {
    score += 3;
  }

  if (cluster.counties.length > 1) {
    score -= 3;
  }

  return roundScore(clampScore(score, 20, 100));
}

function calculateSpreadPenalty(rows: GeoZipReferenceRow[]): number {
  const points = rows
    .map((row) => {
      const latitude = toNumber(row.latitude);
      const longitude = toNumber(row.longitude);
      if (latitude === null || longitude === null) {
        return null;
      }

      return { latitude, longitude };
    })
    .filter((point): point is { latitude: number; longitude: number } => point !== null);

  if (points.length < 2) {
    return 0;
  }

  const centroid = points.reduce(
    (acc, point) => ({
      latitude: acc.latitude + point.latitude / points.length,
      longitude: acc.longitude + point.longitude / points.length,
    }),
    { latitude: 0, longitude: 0 }
  );

  const averageDistance =
    points.reduce(
      (sum, point) =>
        sum +
        haversineMiles(
          point.latitude,
          point.longitude,
          centroid.latitude,
          centroid.longitude
        ),
      0
    ) / points.length;

  return roundScore(Math.min(15, averageDistance * 1.5));
}

function calculateCentroid(
  rows: GeoZipReferenceRow[]
): { latitude: number | null; longitude: number | null } {
  const points = rows
    .map((row) => {
      const latitude = toNumber(row.latitude);
      const longitude = toNumber(row.longitude);
      if (latitude === null || longitude === null) {
        return null;
      }

      return { latitude, longitude };
    })
    .filter((point): point is { latitude: number; longitude: number } => point !== null);

  if (points.length === 0) {
    return { latitude: null, longitude: null };
  }

  return {
    latitude: roundScore(
      points.reduce((sum, point) => sum + point.latitude, 0) / points.length
    ),
    longitude: roundScore(
      points.reduce((sum, point) => sum + point.longitude, 0) / points.length
    ),
  };
}

export function aggregateCityCoverage(
  rows: GeoZipReferenceRow[],
  cityZipCounts: Map<string, number>
): CityCoverageCluster[] {
  const groups = new Map<string, GeoZipReferenceRow[]>();

  for (const row of rows) {
    const key = `${row.state}|${row.city}`;
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const [state, city] = key.split("|");
      const zipCodes = [...new Set(groupRows.map((row) => row.zip_code))].sort();
      const totalCityZipCount = Math.max(
        cityZipCounts.get(key) ?? zipCodes.length,
        zipCodes.length
      );
      const densityRatio = zipCodes.length / totalCityZipCount;
      const population = groupRows.reduce(
        (sum, row) => sum + Math.max(0, row.population_estimate ?? 0),
        0
      );
      const centroid = calculateCentroid(groupRows);

      return {
        city,
        state,
        zipCodes,
        eligibleZipCount: zipCodes.length,
        population,
        totalCityZipCount,
        densityRatio,
        avgDistanceMiles: roundScore(calculateSpreadPenalty(groupRows) / 1.5),
        counties: [...new Set(groupRows.map((row) => row.county).filter(Boolean))] as string[],
        centroidLatitude: centroid.latitude,
        centroidLongitude: centroid.longitude,
      };
    })
    .sort((a, b) =>
      `${a.state}|${a.city}`.localeCompare(`${b.state}|${b.city}`)
    );
}

export function scoreCityCoverage(
  cluster: CityCoverageCluster,
  missingZipCount = 0
): RankedDeploymentCandidate {
  const coverageScore = roundScore(Math.min(25, cluster.eligibleZipCount * 5));
  const pestPressureScore = estimatePestPressureScore(cluster);

  const populationScore = roundScore(
    Math.min(25, (Math.log10(Math.max(cluster.population, 1)) / 6) * 25)
  );

  const densityScore = roundScore(cluster.densityRatio * 20);
  const spreadPenalty = roundScore(
    Math.min(15, cluster.avgDistanceMiles * 1.5)
  );

  let deploymentFitScore = 0;
  if (
    cluster.population >= TARGET_POPULATION_MIN &&
    cluster.population <= TARGET_POPULATION_MAX
  ) {
    deploymentFitScore = 15;
  } else if (cluster.population >= 10_000 && cluster.population <= 500_000) {
    deploymentFitScore = 10;
  } else if (cluster.population > 0) {
    deploymentFitScore = 5;
  }

  const preKeywordScore = roundScore(
    Math.max(
      0,
      Math.min(
        100,
        coverageScore +
          populationScore +
          densityScore +
          deploymentFitScore -
          spreadPenalty +
          ((pestPressureScore - 50) / 10)
      )
    )
  );

  return {
    ...cluster,
    preKeywordScore,
    coverageScore,
    populationScore,
    densityScore,
    spreadPenalty,
    deploymentFitScore,
    pestPressureScore,
    searchIdentityConfidence: 1,
    missingZipCount,
    clusterId: "",
    clusterPopulation: cluster.population,
    clusterCityCount: 1,
    clusterAnchor: {
      city: cluster.city,
      state: cluster.state,
      population: cluster.population,
    },
    clusterDistanceMiles: 0,
    marketType: cluster.population >= TARGET_POPULATION_MIN &&
      cluster.population <= TARGET_POPULATION_MAX
      ? "standalone_city"
      : cluster.population >= METRO_PARENT_POPULATION_MIN
        ? "metro_parent"
        : "secondary",
    metroParent: null,
    reasonSummary:
      `${cluster.eligibleZipCount} ZIPs cover ${cluster.city}, ${cluster.state}; ` +
      `density ${(cluster.densityRatio * 100).toFixed(0)}%; population proxy ${cluster.population}.`,
  };
}

function sharesCounty(
  left: RankedDeploymentCandidate,
  right: RankedDeploymentCandidate
): boolean {
  return left.counties.some((county) => right.counties.includes(county));
}

function getDistanceBetweenCandidates(
  left: RankedDeploymentCandidate,
  right: RankedDeploymentCandidate
): number | null {
  if (
    left.centroidLatitude === null ||
    left.centroidLongitude === null ||
    right.centroidLatitude === null ||
    right.centroidLongitude === null
  ) {
    return null;
  }

  return roundScore(
    haversineMiles(
      left.centroidLatitude,
      left.centroidLongitude,
      right.centroidLatitude,
      right.centroidLongitude
    )
  );
}

interface ClusterAnchorAssignment {
  id: string;
  anchorCity: string;
  anchorState: string;
  anchorPopulation: number;
  memberKeys: string[];
}

function getCandidateKey(candidate: RankedDeploymentCandidate): string {
  return `${candidate.state}|${candidate.city}`;
}

function canJoinCluster(
  candidate: RankedDeploymentCandidate,
  anchor: RankedDeploymentCandidate
): {
  distanceMiles: number | null;
  countyMatch: boolean;
} | null {
  const distanceMiles = getDistanceBetweenCandidates(candidate, anchor);
  const countyMatch = sharesCounty(candidate, anchor);
  const qualifiesByDistance =
    distanceMiles !== null &&
    distanceMiles <= CLUSTER_RADIUS_MILES;

  if (!countyMatch && !qualifiesByDistance) {
    return null;
  }

  return {
    distanceMiles,
    countyMatch,
  };
}

function buildCandidateClusters(
  candidates: RankedDeploymentCandidate[]
): Map<string, ClusterAnchorAssignment> {
  const candidateMap = new Map(
    candidates.map((candidate) => [getCandidateKey(candidate), candidate])
  );
  const anchors: ClusterAnchorAssignment[] = [];
  const anchorCandidates = [...candidates]
    .filter((candidate) => candidate.population >= TARGET_POPULATION_MIN)
    .sort((a, b) => {
      if (b.population !== a.population) {
        return b.population - a.population;
      }

      if (b.preKeywordScore !== a.preKeywordScore) {
        return b.preKeywordScore - a.preKeywordScore;
      }

      return getCandidateKey(a).localeCompare(getCandidateKey(b));
    });

  for (const candidate of anchorCandidates) {
    const existingAnchor = anchors.find((anchor) => {
      const anchorCandidate = candidateMap.get(
        `${anchor.anchorState}|${anchor.anchorCity}`
      );
      return anchorCandidate ? canJoinCluster(candidate, anchorCandidate) !== null : false;
    });

    if (existingAnchor) {
      continue;
    }

    anchors.push({
      id: `${candidate.state}-${candidate.city}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      anchorCity: candidate.city,
      anchorState: candidate.state,
      anchorPopulation: candidate.population,
      memberKeys: [],
    });
  }

  if (anchors.length === 0 && candidates.length > 0) {
    const fallback = [...candidates].sort((a, b) => {
      if (b.preKeywordScore !== a.preKeywordScore) {
        return b.preKeywordScore - a.preKeywordScore;
      }

      if (b.population !== a.population) {
        return b.population - a.population;
      }

      return getCandidateKey(a).localeCompare(getCandidateKey(b));
    })[0];
    anchors.push({
      id: `${fallback.state}-${fallback.city}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      anchorCity: fallback.city,
      anchorState: fallback.state,
      anchorPopulation: fallback.population,
      memberKeys: [],
    });
  }

  const clusterAssignments = new Map<string, ClusterAnchorAssignment>();

  for (const candidate of candidates) {
    const matchingAnchors = anchors
      .map((anchor) => {
        const anchorCandidate = candidateMap.get(
          `${anchor.anchorState}|${anchor.anchorCity}`
        );
        if (!anchorCandidate) {
          return null;
        }

        const match = canJoinCluster(candidate, anchorCandidate);
        if (!match) {
          return null;
        }

        return {
          anchor,
          anchorCandidate,
          distanceMiles: match.distanceMiles,
          countyMatch: match.countyMatch,
        };
      })
      .filter((match): match is {
        anchor: ClusterAnchorAssignment;
        anchorCandidate: RankedDeploymentCandidate;
        distanceMiles: number | null;
        countyMatch: boolean;
      } => match !== null)
      .sort((a, b) => {
        const aCountyRank = a.countyMatch ? 0 : 1;
        const bCountyRank = b.countyMatch ? 0 : 1;
        if (aCountyRank !== bCountyRank) {
          return aCountyRank - bCountyRank;
        }

        const aDistance = a.distanceMiles ?? Number.POSITIVE_INFINITY;
        const bDistance = b.distanceMiles ?? Number.POSITIVE_INFINITY;
        if (aDistance !== bDistance) {
          return aDistance - bDistance;
        }

        if (b.anchorCandidate.population !== a.anchorCandidate.population) {
          return b.anchorCandidate.population - a.anchorCandidate.population;
        }

        return a.anchor.id.localeCompare(b.anchor.id);
      });

    const chosenAnchor =
      matchingAnchors[0]?.anchor ??
      {
        id: `${candidate.state}-${candidate.city}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        anchorCity: candidate.city,
        anchorState: candidate.state,
        anchorPopulation: candidate.population,
        memberKeys: [],
      };

    const stored = clusterAssignments.get(chosenAnchor.id) ?? chosenAnchor;
    stored.memberKeys.push(getCandidateKey(candidate));
    clusterAssignments.set(chosenAnchor.id, stored);
  }

  return clusterAssignments;
}

function classifyDeploymentCandidates(
  candidates: RankedDeploymentCandidate[]
): RankedDeploymentCandidate[] {
  const candidateMap = new Map(
    candidates.map((candidate) => [getCandidateKey(candidate), candidate])
  );
  const clusters = buildCandidateClusters(candidates);
  const clusterByMember = new Map<
    string,
    {
      cluster: ClusterAnchorAssignment;
      population: number;
      cityCount: number;
    }
  >();

  for (const cluster of clusters.values()) {
    const clusterPopulation = cluster.memberKeys.reduce(
      (sum, key) => sum + (candidateMap.get(key)?.population ?? 0),
      0
    );
    const cityCount = cluster.memberKeys.length;
    for (const key of cluster.memberKeys) {
      clusterByMember.set(key, {
        cluster,
        population: clusterPopulation,
        cityCount,
      });
    }
  }

  return candidates.map((candidate) => {
    const candidateKey = getCandidateKey(candidate);
    const clusterContext = clusterByMember.get(candidateKey);
    const cluster =
      clusterContext?.cluster ?? {
        id: `${candidate.state}-${candidate.city}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        anchorCity: candidate.city,
        anchorState: candidate.state,
        anchorPopulation: candidate.population,
        memberKeys: [candidateKey],
      };
    const clusterPopulation = clusterContext?.population ?? candidate.population;
    const clusterCityCount = clusterContext?.cityCount ?? 1;
    const anchorCandidate = candidateMap.get(`${cluster.anchorState}|${cluster.anchorCity}`) ?? candidate;
    const clusterDistance = getDistanceBetweenCandidates(candidate, anchorCandidate);
    const isAnchor =
      candidate.city === cluster.anchorCity && candidate.state === cluster.anchorState;

    if (
      isAnchor &&
      candidate.population >= TARGET_POPULATION_MIN &&
      candidate.population <= TARGET_POPULATION_MAX
    ) {
      return {
        ...candidate,
        clusterId: cluster.id,
        clusterPopulation,
        clusterCityCount,
        clusterAnchor: {
          city: cluster.anchorCity,
          state: cluster.anchorState,
          population: anchorCandidate.population,
        },
        clusterDistanceMiles: clusterDistance,
        marketType: "standalone_city",
        searchIdentityConfidence: 1,
      };
    }

    if (
      isAnchor &&
      (candidate.population > TARGET_POPULATION_MAX ||
        (clusterPopulation >= METRO_PARENT_POPULATION_MIN && clusterCityCount > 1))
    ) {
      return {
        ...candidate,
        clusterId: cluster.id,
        clusterPopulation,
        clusterCityCount,
        clusterAnchor: {
          city: cluster.anchorCity,
          state: cluster.anchorState,
          population: anchorCandidate.population,
        },
        clusterDistanceMiles: clusterDistance,
        marketType: "metro_parent",
        searchIdentityConfidence: 1,
        reasonSummary:
          `${candidate.reasonSummary} Anchors the ${cluster.anchorCity}, ${cluster.anchorState} cluster ` +
          `(${clusterCityCount} cities, pop ${clusterPopulation}).`,
      };
    }

    if (
      !isAnchor &&
      candidate.population >= SUBURB_POPULATION_MIN &&
      candidate.population <= SUBURB_POPULATION_MAX &&
      clusterPopulation >= METRO_PARENT_POPULATION_MIN
    ) {
      const metroParent = {
        city: cluster.anchorCity,
        state: cluster.anchorState,
        population: anchorCandidate.population,
        distanceMiles: clusterDistance,
      };
      const searchIdentityConfidence = roundScore(clampScore(
        (candidate.population >= 50_000 ? 1 : 0.85) +
        (candidate.eligibleZipCount >= 2 ? 0.1 : 0) +
        (candidate.counties.some((county) => !anchorCandidate.counties.includes(county)) ? -0.15 : 0),
        0.5,
        1
      ));
      const distanceLabel =
        clusterDistance === null
          ? "same cluster"
          : `${clusterDistance.toFixed(1)} miles from anchor`;

      return {
        ...candidate,
        clusterId: cluster.id,
        clusterPopulation,
        clusterCityCount,
        clusterAnchor: {
          city: cluster.anchorCity,
          state: cluster.anchorState,
          population: anchorCandidate.population,
        },
        clusterDistanceMiles: clusterDistance,
        marketType: "suburb",
        searchIdentityConfidence,
        metroParent,
        reasonSummary:
          `${candidate.reasonSummary} Included in the ${cluster.anchorCity}, ${cluster.anchorState} ` +
          `cluster (${clusterCityCount} cities, pop ${clusterPopulation}; ${distanceLabel}; ` +
          `search identity ${searchIdentityConfidence}).`,
      };
    }

    return {
      ...candidate,
      clusterId: cluster.id,
      clusterPopulation,
      clusterCityCount,
      clusterAnchor: {
        city: cluster.anchorCity,
        state: cluster.anchorState,
        population: anchorCandidate.population,
      },
      clusterDistanceMiles: clusterDistance,
      marketType: "secondary",
      searchIdentityConfidence: 0.5,
      reasonSummary:
        `${candidate.reasonSummary} Remains a secondary target inside the ${cluster.anchorCity}, ` +
        `${cluster.anchorState} cluster (${clusterCityCount} cities, pop ${clusterPopulation}).`,
    };
  });
}

export function selectDeploymentCandidates(
  ranked: RankedDeploymentCandidate[],
  topN: number
): RankedDeploymentCandidate[] {
  const suburbs = ranked.filter((candidate) => candidate.marketType === "suburb");
  const standaloneCities = ranked.filter(
    (candidate) => candidate.marketType === "standalone_city"
  );
  const fallback = ranked.filter(
    (candidate) =>
      candidate.marketType !== "suburb" &&
      candidate.marketType !== "standalone_city"
  );

  const selected: RankedDeploymentCandidate[] = [];
  let suburbIndex = 0;
  let standaloneIndex = 0;
  let fallbackIndex = 0;

  while (
    selected.length < topN &&
    (suburbIndex < suburbs.length || standaloneIndex < standaloneCities.length)
  ) {
    for (let slot = 0; slot < 2 && selected.length < topN; slot += 1) {
      if (suburbIndex < suburbs.length) {
        selected.push(suburbs[suburbIndex]);
        suburbIndex += 1;
      } else if (standaloneIndex < standaloneCities.length) {
        selected.push(standaloneCities[standaloneIndex]);
        standaloneIndex += 1;
      }
    }

    if (selected.length >= topN) {
      break;
    }

    if (standaloneIndex < standaloneCities.length) {
      selected.push(standaloneCities[standaloneIndex]);
      standaloneIndex += 1;
    } else if (suburbIndex < suburbs.length) {
      selected.push(suburbs[suburbIndex]);
      suburbIndex += 1;
    }
  }

  while (selected.length < topN && fallbackIndex < fallback.length) {
    selected.push(fallback[fallbackIndex]);
    fallbackIndex += 1;
  }

  return selected;
}

export function rankDeploymentCandidates(
  rows: GeoZipReferenceRow[],
  cityZipCounts: Map<string, number>,
  missingZipCount = 0
): RankedDeploymentCandidate[] {
  return classifyDeploymentCandidates(
    aggregateCityCoverage(rows, cityZipCounts)
      .map((cluster) => scoreCityCoverage(cluster, missingZipCount))
  )
    .sort((a, b) => {
      const marketPriority = {
        standalone_city: 0,
        suburb: 1,
        metro_parent: 2,
        secondary: 3,
      } as const;
      if (b.preKeywordScore !== a.preKeywordScore) {
        return b.preKeywordScore - a.preKeywordScore;
      }

      if (marketPriority[a.marketType] !== marketPriority[b.marketType]) {
        return marketPriority[a.marketType] - marketPriority[b.marketType];
      }

      if (b.eligibleZipCount !== a.eligibleZipCount) {
        return b.eligibleZipCount - a.eligibleZipCount;
      }

      if (b.population !== a.population) {
        return b.population - a.population;
      }

      return `${a.state}|${a.city}`.localeCompare(`${b.state}|${b.city}`);
    });
}

async function persistOfferCoverage(
  db: DbClient,
  offerId: string,
  zipCodes: string[],
  source: string
): Promise<void> {
  for (const zipCode of zipCodes) {
    await db.query(
      `INSERT INTO offer_geo_coverage (offer_id, zip_code, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (offer_id, zip_code) DO UPDATE SET
         source = EXCLUDED.source`,
      [offerId, zipCode, source]
    );
  }
}

async function loadOfferCoverage(
  db: DbClient,
  offerId: string
): Promise<string[]> {
  const result = await db.query<{ zip_code: string }>(
    `SELECT zip_code
     FROM offer_geo_coverage
     WHERE offer_id = $1
     ORDER BY zip_code`,
    [offerId]
  );

  return result.rows.map((row) => row.zip_code);
}

async function loadGeoRows(
  db: DbClient,
  zipCodes: string[]
): Promise<GeoZipReferenceRow[]> {
  if (zipCodes.length === 0) {
    return [];
  }

  const result = await db.query<GeoZipReferenceRow>(
    `SELECT zip_code, city, state, county, latitude, longitude, population_estimate
     FROM geo_zip_reference
     WHERE zip_code = ANY($1::text[])`,
    [zipCodes]
  );

  return result.rows;
}

async function loadCityZipCounts(
  db: DbClient,
  rows: GeoZipReferenceRow[]
): Promise<Map<string, number>> {
  const states = [...new Set(rows.map((row) => row.state))];
  if (states.length === 0) {
    return new Map<string, number>();
  }

  const result = await db.query<CityZipCountRow>(
    `SELECT city, state, COUNT(*)::int AS total_zip_count
     FROM geo_zip_reference
     WHERE state = ANY($1::text[])
     GROUP BY city, state`,
    [states]
  );

  return new Map<string, number>(
    result.rows.map((row) => [`${row.state}|${row.city}`, row.total_zip_count])
  );
}

function buildReasoning(candidate: RankedDeploymentCandidate, missingZipCount: number): Record<string, unknown> {
  return {
    summary: candidate.reasonSummary,
    pipeline:
      candidate.marketType === "standalone_city" || candidate.marketType === "suburb"
        ? candidate.marketType
        : null,
    cluster: {
      id: candidate.clusterId,
      population: candidate.clusterPopulation,
      city_count: candidate.clusterCityCount,
      anchor_city: candidate.clusterAnchor.city,
      anchor_state: candidate.clusterAnchor.state,
      anchor_population: candidate.clusterAnchor.population,
      distance_miles: candidate.clusterDistanceMiles,
    },
    market_type: candidate.marketType,
    search_identity_confidence: candidate.searchIdentityConfidence,
    pest_pressure_score: candidate.pestPressureScore,
    metro_parent: candidate.metroParent
      ? {
          city: candidate.metroParent.city,
          state: candidate.metroParent.state,
          population: candidate.metroParent.population,
          distance_miles: candidate.metroParent.distanceMiles,
        }
      : null,
    coverage_score: candidate.coverageScore,
    population_score: candidate.populationScore,
    density_score: candidate.densityScore,
    spread_penalty: candidate.spreadPenalty,
    deployment_fit_score: candidate.deploymentFitScore,
    density_ratio: roundScore(candidate.densityRatio),
    total_city_zip_count: candidate.totalCityZipCount,
    avg_distance_miles: candidate.avgDistanceMiles,
    missing_zip_count: missingZipCount,
    counties: candidate.counties,
  };
}

export function shouldTriggerGeoReferenceRefresh(
  totalZipCount: number,
  missingZipCount: number,
  countThreshold = DEFAULT_MISSING_ZIP_COUNT_THRESHOLD,
  ratioThreshold = DEFAULT_MISSING_ZIP_RATIO_THRESHOLD
): boolean {
  if (totalZipCount <= 0 || missingZipCount <= 0) {
    return false;
  }

  const missingZipRatio = missingZipCount / totalZipCount;
  return missingZipCount >= countThreshold || missingZipRatio > ratioThreshold;
}

export function buildGeoReferenceRefreshPrompt(offerId: string, missingZipCount: number, totalZipCount: number): string {
  return [
    `Implement /root/general-projects/parallel-callforge/docs/plans/2026-03-02-geo-zip-reference-dataset-plan.md end-to-end.`,
    `Then run the importer so geo_zip_reference can cover offer ${offerId}.`,
    `This offer currently has ${missingZipCount} unmapped ZIPs out of ${totalZipCount} total ZIPs.`,
    `Use a script-first approach, create src/shared/db/import-geo-zip-reference.ts, add npm script import:geo-zips, load the dataset, and report final row counts.`,
  ].join(" ");
}

async function maybeRefreshGeoReference(
  offerId: string,
  totalZipCount: number,
  missingZipCount: number,
  config: Agent05Config,
  db: DbClient
): Promise<GeoReferenceRefreshOutcome> {
  const mode = config.geoReferenceRefreshMode ?? "prompt";
  const prompt = buildGeoReferenceRefreshPrompt(offerId, missingZipCount, totalZipCount);

  if (!config.autoRefreshGeoReference) {
    return {
      triggered: false,
      mode,
      reason: "Auto-refresh disabled; prompt prepared only",
      prompt,
    };
  }

  if (mode === "script") {
    try {
      await importGeoZipReferenceIntoDb(db);
      return {
        triggered: true,
        mode: "script",
        reason: "Geo reference import script completed",
        scriptAttempted: true,
        scriptSucceeded: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        triggered: true,
        mode: "script",
        reason: `Geo reference import script failed: ${message}`,
        prompt,
        scriptAttempted: true,
        scriptSucceeded: false,
      };
    }
  }

  return {
    triggered: true,
    mode: "prompt",
    reason: "Geo reference import script unavailable; prompt prepared",
    prompt,
    scriptAttempted: false,
    scriptSucceeded: false,
  };
}

async function getGeoReferenceRowCount(db: DbClient): Promise<number> {
  const result = await db.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM geo_zip_reference"
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function ensureGeoReferenceCoverage(
  db: DbClient,
  offerId: string,
  config: Agent05Config
): Promise<void> {
  const rowCount = await getGeoReferenceRowCount(db);
  if (rowCount >= MIN_EXPECTED_GEO_REFERENCE_ROWS) {
    return;
  }

  console.warn(
    `[Agent 0.5] geo_zip_reference is undersized (${rowCount} rows). Refreshing before scoring ${offerId}.`
  );
  const refresh = await maybeRefreshGeoReference(offerId, rowCount, rowCount, {
    ...config,
    autoRefreshGeoReference: config.autoRefreshGeoReference ?? true,
    geoReferenceRefreshMode: "script",
  }, db);
  console.warn(`[Agent 0.5] ${refresh.reason}`);

  const refreshedRowCount = await getGeoReferenceRowCount(db);
  if (refreshedRowCount < MIN_EXPECTED_GEO_REFERENCE_ROWS) {
    throw new Error(
      `geo_zip_reference remains undersized after refresh (${refreshedRowCount} rows; expected at least ${MIN_EXPECTED_GEO_REFERENCE_ROWS})`
    );
  }
}

export async function runAgent05(
  config: Agent05Config,
  db: DbClient
): Promise<RankedDeploymentCandidate[]> {
  const startedAt = Date.now();
  const offerId = config.offerId.trim();
  if (offerId.length === 0) {
    throw new Error("Agent 0.5 requires a non-empty offerId");
  }

  console.log(`[Agent 0.5] Starting geo scan for ${offerId}`);
  eventBus.emitEvent({
    type: "agent_start",
    agent: "agent-0.5",
    timestamp: startedAt,
  });
  eventBus.emitEvent({
    type: "agent_step",
    agent: "agent-0.5",
    step: "Starting",
    detail: offerId,
    timestamp: startedAt,
  });

  try {
    const source = config.source?.trim() || "import";
    const inputZipCodes = config.zipCodes ? normalizeZipList(config.zipCodes) : [];

    if (inputZipCodes.length > 0) {
      eventBus.emitEvent({
        type: "agent_step",
        agent: "agent-0.5",
        step: "Saving coverage",
        detail: `${inputZipCodes.length} ZIPs`,
        timestamp: Date.now(),
      });
      await persistOfferCoverage(db, offerId, inputZipCodes, source);
    }

    let allZipCodes = inputZipCodes.length > 0
      ? inputZipCodes
      : normalizeZipList(await loadOfferCoverage(db, offerId));

    if (allZipCodes.length === 0 && inputZipCodes.length === 0) {
      const syncedZipCount = await syncOfferGeoCoverageFromProfile(db, offerId);
      if (syncedZipCount > 0) {
        console.log(`[Agent 0.5] Imported ${syncedZipCount} ZIPs from offer profile for ${offerId}`);
        allZipCodes = normalizeZipList(await loadOfferCoverage(db, offerId));
      }
    }

    if (allZipCodes.length === 0) {
      throw new Error(`No ZIP coverage available for offer ${offerId}`);
    }

    if (config.llm) {
      const llm = config.llm;
      await withSelfHealing({
        runId: config.runId ?? "no-run-id",
        offerId: config.offerId,
        agentName: "agent-0.5",
        step: "geo_reference_coverage",
        fn: () => ensureGeoReferenceCoverage(db, offerId, config),
        getRepairContext: (err) => `
Geo ZIP reference coverage check failed:
${err.message}

The geo reference table (geo_zip_reference) needs to have at least ${MIN_EXPECTED_GEO_REFERENCE_ROWS} rows.
Diagnose the failure and suggest how to fix it.
Return JSON: { "fixed_code": "description of what to do", "summary": "root cause" }
`,
        applyFix: async (fixedCode) => {
          console.warn(`[Agent 0.5][SelfHealing] LLM repair suggestion: ${fixedCode}`);
          // Geo reference fixes are usually data issues — log for operator
        },
        db,
        llm,
      });
    } else {
      await ensureGeoReferenceCoverage(db, offerId, config);
    }

    const checkpointScope = buildCheckpointScope([
      offerId,
      source,
      allZipCodes,
      config.topN ?? null,
    ]);
    const checkpoints = await createCheckpointTracker(
      db,
      "agent-0.5",
      checkpointScope
    );
    const savedCheckpoint = checkpoints.get<{ selected?: RankedDeploymentCandidate[] }>(
      "deployment_candidates_saved"
    );
    if (Array.isArray(savedCheckpoint?.selected) && savedCheckpoint.selected.length > 0) {
      console.log(
        `[Agent 0.5] Reusing checkpointed deployment candidates for ${offerId} (${savedCheckpoint.selected.length} cities)`
      );
      eventBus.emitEvent({
        type: "agent_step",
        agent: "agent-0.5",
        step: "Checkpoint hit",
        detail: `${savedCheckpoint.selected.length} cities`,
        timestamp: Date.now(),
      });
      return savedCheckpoint.selected;
    }

    eventBus.emitEvent({
      type: "agent_step",
      agent: "agent-0.5",
      step: "Mapping ZIPs",
      detail: `${allZipCodes.length} ZIPs`,
      timestamp: Date.now(),
    });
    const geoRows = await loadGeoRows(db, allZipCodes);
    const mappedZipCodes = new Set(geoRows.map((row) => row.zip_code));
    const missingZipCount = allZipCodes.filter((zip) => !mappedZipCodes.has(zip)).length;
    const missingZipRatio = allZipCodes.length > 0 ? missingZipCount / allZipCodes.length : 0;
    const cityZipCounts = await loadCityZipCounts(db, geoRows);
    console.log(
      `[Agent 0.5] ZIP mapping complete: ${geoRows.length}/${allZipCodes.length} mapped rows across ${cityZipCounts.size} cities (${missingZipCount} missing)`
    );

    let geoReferenceRefresh: GeoReferenceRefreshOutcome | null = null;
    if (
      shouldTriggerGeoReferenceRefresh(
        allZipCodes.length,
        missingZipCount,
        config.missingZipCountThreshold ?? DEFAULT_MISSING_ZIP_COUNT_THRESHOLD,
        config.missingZipRatioThreshold ?? DEFAULT_MISSING_ZIP_RATIO_THRESHOLD
      )
    ) {
      eventBus.emitEvent({
        type: "agent_step",
        agent: "agent-0.5",
        step: "Escalating reference",
        detail: `${missingZipCount} unmapped ZIPs`,
        timestamp: Date.now(),
      });
      geoReferenceRefresh = await maybeRefreshGeoReference(
        offerId,
        allZipCodes.length,
        missingZipCount,
        config,
        db
      );
      console.warn(
        `[Agent 0.5] High unmapped ZIP coverage for ${offerId}: ${missingZipCount}/${allZipCodes.length}. ${geoReferenceRefresh.reason}`
      );
      if (geoReferenceRefresh.prompt) {
        console.warn(`[Agent 0.5] Geo reference refresh prompt: ${geoReferenceRefresh.prompt}`);
      }
    }

    eventBus.emitEvent({
      type: "agent_step",
      agent: "agent-0.5",
      step: "Scoring cities",
      detail: `${geoRows.length} mapped ZIPs`,
      timestamp: Date.now(),
    });
    const ranked = rankDeploymentCandidates(geoRows, cityZipCounts, missingZipCount);
    const topN = Math.max(1, config.topN ?? ranked.length);
    const selected = selectDeploymentCandidates(ranked, topN);
    console.log(
      `[Agent 0.5] Ranked ${ranked.length} candidate cities; selecting top ${selected.length}`
    );
    for (const [index, candidate] of selected.entries()) {
      console.log(
        `[Agent 0.5] Candidate ${index + 1}/${selected.length}: ${candidate.city}, ${candidate.state} score=${candidate.preKeywordScore} zips=${candidate.eligibleZipCount} pop=${candidate.population}`
      );
    }

    const writeCandidates = async (writer: DbClient) => {
      await writer.query("DELETE FROM deployment_candidates WHERE offer_id = $1", [offerId]);

      for (const [index, candidate] of selected.entries()) {
        console.log(
          `[Agent 0.5] Writing candidate ${index + 1}/${selected.length}: ${candidate.city}, ${candidate.state}`
        );
        await writer.query(
          `INSERT INTO deployment_candidates
           (offer_id, city, state, zip_codes, eligible_zip_count, population,
            pre_keyword_score, status, reasoning, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, now(), now())
           ON CONFLICT (offer_id, city, state) DO UPDATE SET
             zip_codes = EXCLUDED.zip_codes,
             eligible_zip_count = EXCLUDED.eligible_zip_count,
             population = EXCLUDED.population,
             pre_keyword_score = EXCLUDED.pre_keyword_score,
             status = 'pending',
             reasoning = EXCLUDED.reasoning,
             updated_at = now()`,
          [
            offerId,
            candidate.city,
            candidate.state,
            candidate.zipCodes,
            candidate.eligibleZipCount,
            candidate.population,
            candidate.preKeywordScore,
            JSON.stringify({
              ...buildReasoning(candidate, missingZipCount),
              queue_position: index + 1,
              missing_zip_ratio: roundScore(missingZipRatio),
              geo_reference_refresh: geoReferenceRefresh,
            }),
          ]
        );
      }
    };

    if (db.withTransaction) {
      await db.withTransaction(writeCandidates);
    } else {
      await writeCandidates(db);
    }

    await checkpoints.mark("deployment_candidates_saved", {
      selected,
    });

    console.log(`[Agent 0.5] Saved ${selected.length} deployment candidates for ${offerId}`);
    eventBus.emitEvent({
      type: "agent_complete",
      agent: "agent-0.5",
      duration: Date.now() - startedAt,
      timestamp: Date.now(),
    });

    return selected;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Agent 0.5] ${message}`);
    eventBus.emitEvent({
      type: "agent_error",
      agent: "agent-0.5",
      error: message,
      timestamp: Date.now(),
    });
    throw error;
  }
}

import { describe, expect, it } from "@jest/globals";
import {
  aggregateCityCoverage,
  buildGeoReferenceRefreshPrompt,
  normalizeZip,
  normalizeZipList,
  parseZipInput,
  rankDeploymentCandidates,
  scoreCityCoverage,
  selectDeploymentCandidates,
  shouldTriggerGeoReferenceRefresh,
  type GeoZipReferenceRow,
} from "./index.js";

const sampleRows: GeoZipReferenceRow[] = [
  {
    zip_code: "95060",
    city: "Santa Cruz",
    state: "CA",
    county: "Santa Cruz",
    latitude: 36.9741,
    longitude: -122.0308,
    population_estimate: 29000,
  },
  {
    zip_code: "95062",
    city: "Santa Cruz",
    state: "CA",
    county: "Santa Cruz",
    latitude: 36.9712,
    longitude: -121.9871,
    population_estimate: 27000,
  },
  {
    zip_code: "95076",
    city: "Watsonville",
    state: "CA",
    county: "Santa Cruz",
    latitude: 36.9102,
    longitude: -121.7569,
    population_estimate: 52000,
  },
];

const metroRows: GeoZipReferenceRow[] = [
  {
    zip_code: "64101",
    city: "Kansas City",
    state: "MO",
    county: "Jackson",
    latitude: 39.1031,
    longitude: -94.5776,
    population_estimate: 255000,
  },
  {
    zip_code: "64102",
    city: "Kansas City",
    state: "MO",
    county: "Jackson",
    latitude: 39.1065,
    longitude: -94.5858,
    population_estimate: 255000,
  },
  {
    zip_code: "66203",
    city: "Shawnee",
    state: "KS",
    county: "Johnson",
    latitude: 39.0228,
    longitude: -94.7152,
    population_estimate: 34000,
  },
  {
    zip_code: "66214",
    city: "Shawnee",
    state: "KS",
    county: "Johnson",
    latitude: 39.0182,
    longitude: -94.7144,
    population_estimate: 34000,
  },
];

describe("Agent 0.5 - Geo Scanner", () => {
  it("normalizes ZIP strings and removes invalid values", () => {
    expect(normalizeZip("95060-1234")).toBe("95060");
    expect(normalizeZip("950629999")).toBe("95062");
    expect(normalizeZip("bad-zip")).toBeNull();
    expect(normalizeZipList(["95060", "95060-9999", "x", "95076"])).toEqual([
      "95060",
      "95076",
    ]);
  });

  it("parses pasted ZIP input from mixed separators", () => {
    expect(parseZipInput("95060, 95062\n95076;95060")).toEqual([
      "95060",
      "95062",
      "95076",
    ]);
  });

  it("aggregates ZIP coverage into deterministic city clusters", () => {
    const cityZipCounts = new Map<string, number>([
      ["CA|Santa Cruz", 4],
      ["CA|Watsonville", 2],
    ]);

    expect(aggregateCityCoverage(sampleRows, cityZipCounts)).toEqual([
      {
        city: "Santa Cruz",
        state: "CA",
        zipCodes: ["95060", "95062"],
        eligibleZipCount: 2,
        population: 56000,
        totalCityZipCount: 4,
        densityRatio: 0.5,
        avgDistanceMiles: expect.any(Number),
        counties: ["Santa Cruz"],
        centroidLatitude: expect.any(Number),
        centroidLongitude: expect.any(Number),
      },
      {
        city: "Watsonville",
        state: "CA",
        zipCodes: ["95076"],
        eligibleZipCount: 1,
        population: 52000,
        totalCityZipCount: 2,
        densityRatio: 0.5,
        avgDistanceMiles: 0,
        counties: ["Santa Cruz"],
        centroidLatitude: 36.91,
        centroidLongitude: -121.76,
      },
    ]);
  });

  it("scores city clusters deterministically", () => {
    const scored = scoreCityCoverage({
      city: "Santa Cruz",
      state: "CA",
      zipCodes: ["95060", "95062"],
      eligibleZipCount: 2,
      population: 56000,
      totalCityZipCount: 4,
      densityRatio: 0.5,
      avgDistanceMiles: 1.2,
      counties: ["Santa Cruz"],
      centroidLatitude: 36.97,
      centroidLongitude: -122.01,
    });

    expect(scored.preKeywordScore).toBeGreaterThan(0);
    expect(scored.preKeywordScore).toBeLessThanOrEqual(100);
    expect(scored.coverageScore).toBe(10);
    expect(scored.deploymentFitScore).toBe(15);
  });

  it("keeps ranking stable for the same input", () => {
    const cityZipCounts = new Map<string, number>([
      ["CA|Santa Cruz", 4],
      ["CA|Watsonville", 2],
    ]);

    const firstPass = rankDeploymentCandidates(sampleRows, cityZipCounts);
    const secondPass = rankDeploymentCandidates(sampleRows, cityZipCounts);

    expect(firstPass.map((candidate) => candidate.city)).toEqual(
      secondPass.map((candidate) => candidate.city)
    );
    expect(firstPass).toHaveLength(2);
    expect(firstPass.map((candidate) => candidate.city).sort()).toEqual([
      "Santa Cruz",
      "Watsonville",
    ]);
  });

  it("classifies nearby sub-75k markets as suburbs of larger metros", () => {
    const cityZipCounts = new Map<string, number>([
      ["MO|Kansas City", 20],
      ["KS|Shawnee", 8],
    ]);

    const ranked = rankDeploymentCandidates(metroRows, cityZipCounts);
    const shawnee = ranked.find((candidate) => candidate.city === "Shawnee");
    const kansasCity = ranked.find((candidate) => candidate.city === "Kansas City");

    expect(kansasCity?.marketType).toBe("metro_parent");
    expect(kansasCity?.clusterAnchor).toEqual({
      city: "Kansas City",
      state: "MO",
      population: 510000,
    });
    expect(kansasCity?.clusterPopulation).toBe(578000);
    expect(kansasCity?.pestPressureScore).toBeGreaterThan(0);
    expect(shawnee?.marketType).toBe("suburb");
    expect(shawnee?.clusterAnchor).toEqual({
      city: "Kansas City",
      state: "MO",
      population: 510000,
    });
    expect(shawnee?.clusterPopulation).toBe(578000);
    expect(shawnee?.searchIdentityConfidence).toBeGreaterThan(0.5);
    expect(shawnee?.searchIdentityConfidence).toBeLessThanOrEqual(1);
    expect(shawnee?.metroParent).toEqual({
      city: "Kansas City",
      state: "MO",
      population: 510000,
      distanceMiles: expect.any(Number),
    });
  });

  it("interleaves two suburbs then one standalone city when selecting the queue", () => {
    const selected = selectDeploymentCandidates([
      { city: "Suburb 1", state: "TX", marketType: "suburb" },
      { city: "Suburb 2", state: "TX", marketType: "suburb" },
      { city: "City 1", state: "TX", marketType: "standalone_city" },
      { city: "Suburb 3", state: "TX", marketType: "suburb" },
      { city: "City 2", state: "TX", marketType: "standalone_city" },
    ] as any, 5);

    expect(selected.map((candidate) => candidate.city)).toEqual([
      "Suburb 1",
      "Suburb 2",
      "City 1",
      "Suburb 3",
      "City 2",
    ]);
  });

  it("triggers geo reference refresh only when thresholds are exceeded", () => {
    expect(shouldTriggerGeoReferenceRefresh(100, 0)).toBe(false);
    expect(shouldTriggerGeoReferenceRefresh(100, 4, 25, 0.05)).toBe(false);
    expect(shouldTriggerGeoReferenceRefresh(100, 6, 25, 0.05)).toBe(true);
    expect(shouldTriggerGeoReferenceRefresh(100, 25, 25, 0.05)).toBe(true);
  });

  it("builds a ready-to-run geo reference refresh prompt", () => {
    const prompt = buildGeoReferenceRefreshPrompt("offer-123", 40, 300);
    expect(prompt).toContain("offer-123");
    expect(prompt).toContain("40 unmapped ZIPs");
    expect(prompt).toContain("import:geo-zips");
  });
});

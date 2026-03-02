import { describe, expect, it } from "@jest/globals";
import {
  buildZipPopulationMapFromCensusResponse,
  buildGeoZipReferenceDataset,
  fillMissingPopulationEstimates,
  normalizeGeoZipRow,
  type RawGeoZipRow,
} from "./import-geo-zip-reference.js";

describe("import-geo-zip-reference", () => {
  it("normalizes a valid GeoNames row", () => {
    const row: RawGeoZipRow = {
      countryCode: "US",
      postalCode: "99553",
      placeName: "Akutan",
      adminName1: "Alaska",
      adminCode1: "AK",
      adminName2: "Aleutians East",
      adminCode2: "013",
      adminName3: "",
      adminCode3: "",
      latitude: "54.143",
      longitude: "-165.7854",
      accuracy: "1",
    };

    expect(normalizeGeoZipRow(row, new Map([["99553", 854]]))).toEqual({
      zip_code: "99553",
      city: "Akutan",
      state: "AK",
      county: "Aleutians East",
      latitude: 54.143,
      longitude: -165.7854,
      population_estimate: 854,
    });
  });

  it("builds a ZIP population map from Census ZCTA API rows", () => {
    const populations = buildZipPopulationMapFromCensusResponse([
      ["P1_001N", "zip code tabulation area"],
      ["854", "99553"],
      ["621", "99571"],
    ]);

    expect(populations.get("99553")).toBe(854);
    expect(populations.get("99571")).toBe(621);
  });

  it("dedupes a ZIP using accuracy, coordinate, county, and lexical order", () => {
    const text = [
      "US\t12345\tBeta City\tNew York\tNY\t\t\t\t\t40.00\t-73.00\t3",
      "US\t12345\tAlpha City\tNew York\tNY\tAlbany\t001\t\t\t40.00\t-73.00\t5",
      "US\t12345\tGamma City\tNew York\tNY\tAlbany\t001\t\t\t\t\t5",
      "US\t54321\tDelta City\tCalifornia\tCA\tOrange\t059\t\t\t33.00\t-117.00\t4",
      "CA\tA1A1A1\tInvalid\tOntario\tON\t\t\t\t\t0\t0\t1",
    ].join("\n");

    const { rows, stats } = buildGeoZipReferenceDataset(
      text,
      new Map([
        ["12345", 1000],
        ["54321", 2000],
      ])
    );

    expect(rows).toEqual([
      {
        zip_code: "12345",
        city: "Alpha City",
        state: "NY",
        county: "Albany",
        latitude: 40,
        longitude: -73,
        population_estimate: 1000,
      },
      {
        zip_code: "54321",
        city: "Delta City",
        state: "CA",
        county: "Orange",
        latitude: 33,
        longitude: -117,
        population_estimate: 2000,
      },
    ]);
    expect(stats.duplicateZipCount).toBe(1);
    expect(stats.finalRowCount).toBe(2);
    expect(stats.imputedPopulationCount).toBe(0);
  });

  it("imputes missing populations from matching city rows before county fallback", () => {
    const result = fillMissingPopulationEstimates([
      {
        zip_code: "11111",
        city: "Alpha City",
        state: "NY",
        county: "Albany",
        latitude: null,
        longitude: null,
        population_estimate: 1000,
      },
      {
        zip_code: "11112",
        city: "Alpha City",
        state: "NY",
        county: "Albany",
        latitude: null,
        longitude: null,
        population_estimate: null,
      },
      {
        zip_code: "11113",
        city: "Beta City",
        state: "NY",
        county: "Albany",
        latitude: null,
        longitude: null,
        population_estimate: null,
      },
    ]);

    expect(result.imputedPopulationCount).toBe(2);
    expect(result.rows[1].population_estimate).toBe(1000);
    expect(result.rows[2].population_estimate).toBe(1000);
  });
});

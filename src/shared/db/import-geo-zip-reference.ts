import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getEnv } from "../../config/env.js";
import type { DbClient } from "./client.js";
import { createDbClient } from "./client.js";

const execFileAsync = promisify(execFile);
const GEONAMES_US_ZIP_URL = "https://download.geonames.org/export/zip/US.zip";
const CENSUS_ZCTA_POPULATION_URL =
  "https://api.census.gov/data/2020/dec/dhc?get=P1_001N&for=zip%20code%20tabulation%20area:*";
const IMPORT_BATCH_SIZE = 500;

export interface RawGeoZipRow {
  countryCode: string;
  postalCode: string;
  placeName: string;
  adminName1: string;
  adminCode1: string;
  adminName2: string;
  adminCode2: string;
  adminName3: string;
  adminCode3: string;
  latitude: string;
  longitude: string;
  accuracy: string;
}

export interface GeoZipReferenceImportRow {
  zip_code: string;
  city: string;
  state: string;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  population_estimate: number | null;
}

export interface GeoZipImportStats {
  rawRowCount: number;
  validRowCount: number;
  finalRowCount: number;
  duplicateZipCount: number;
  invalidRowCount: number;
  imputedPopulationCount: number;
}

type ZipPopulationMap = Map<string, number>;

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
  "puerto rico": "PR",
  "u.s. virgin islands": "VI",
  "virgin islands": "VI",
  guam: "GU",
  "american samoa": "AS",
  "northern mariana islands": "MP",
};

function normalizeZip(value: string): string | null {
  const digits = value.trim().replace(/\D/g, "");
  if (!/^\d{5}$/.test(digits)) {
    return null;
  }

  return digits;
}

function parseNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStateCode(adminCode1: string, adminName1: string): string | null {
  const code = adminCode1.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) {
    return code;
  }

  const fallback = STATE_NAME_TO_CODE[adminName1.trim().toLowerCase()];
  return fallback ?? null;
}

function parseRawGeoZipRows(text: string): RawGeoZipRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [
        countryCode = "",
        postalCode = "",
        placeName = "",
        adminName1 = "",
        adminCode1 = "",
        adminName2 = "",
        adminCode2 = "",
        adminName3 = "",
        adminCode3 = "",
        latitude = "",
        longitude = "",
        accuracy = "",
      ] = line.split("\t");

      return {
        countryCode,
        postalCode,
        placeName,
        adminName1,
        adminCode1,
        adminName2,
        adminCode2,
        adminName3,
        adminCode3,
        latitude,
        longitude,
        accuracy,
      };
    });
}

export function buildZipPopulationMapFromCensusResponse(payload: unknown): ZipPopulationMap {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("Census population response was empty");
  }

  const [header, ...rows] = payload;
  if (
    !Array.isArray(header) ||
    header[0] !== "P1_001N" ||
    header[1] !== "zip code tabulation area"
  ) {
    throw new Error("Census population response did not match expected schema");
  }

  const populations = new Map<string, number>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) {
      continue;
    }

    const population = Number(row[0]);
    const zip = normalizeZip(String(row[1]));
    if (!zip || !Number.isFinite(population) || population < 0) {
      continue;
    }

    populations.set(zip, population);
  }

  return populations;
}

export function normalizeGeoZipRow(
  raw: RawGeoZipRow,
  zipPopulations: ZipPopulationMap = new Map()
): GeoZipReferenceImportRow | null {
  if (raw.countryCode.trim().toUpperCase() !== "US") {
    return null;
  }

  const zip = normalizeZip(raw.postalCode);
  const city = raw.placeName.trim();
  const state = normalizeStateCode(raw.adminCode1, raw.adminName1);

  if (!zip || !city || !state) {
    return null;
  }

  return {
    zip_code: zip,
    city,
    state,
    county: raw.adminName2.trim() || null,
    latitude: parseNumber(raw.latitude),
    longitude: parseNumber(raw.longitude),
    population_estimate: zipPopulations.get(zip) ?? null,
  };
}

function compareRows(a: RawGeoZipRow, b: RawGeoZipRow): number {
  const accuracyA = Number(a.accuracy.trim() || "0");
  const accuracyB = Number(b.accuracy.trim() || "0");
  if (accuracyA !== accuracyB) {
    return accuracyB - accuracyA;
  }

  const hasCoordsA = parseNumber(a.latitude) !== null && parseNumber(a.longitude) !== null ? 1 : 0;
  const hasCoordsB = parseNumber(b.latitude) !== null && parseNumber(b.longitude) !== null ? 1 : 0;
  if (hasCoordsA !== hasCoordsB) {
    return hasCoordsB - hasCoordsA;
  }

  const hasCountyA = a.adminName2.trim() ? 1 : 0;
  const hasCountyB = b.adminName2.trim() ? 1 : 0;
  if (hasCountyA !== hasCountyB) {
    return hasCountyB - hasCountyA;
  }

  return [
    a.placeName.trim(),
    a.adminCode1.trim(),
    a.adminName2.trim(),
  ].join("|").localeCompare([
    b.placeName.trim(),
    b.adminCode1.trim(),
    b.adminName2.trim(),
  ].join("|"));
}

function roundPopulation(value: number): number {
  return Math.max(0, Math.round(value));
}

export function fillMissingPopulationEstimates(rows: GeoZipReferenceImportRow[]): {
  rows: GeoZipReferenceImportRow[];
  imputedPopulationCount: number;
} {
  const cityTotals = new Map<string, { total: number; count: number }>();
  const countyTotals = new Map<string, { total: number; count: number }>();

  for (const row of rows) {
    if (row.population_estimate === null) {
      continue;
    }

    const cityKey = `${row.state}|${row.city.trim().toLowerCase()}`;
    const cityBucket = cityTotals.get(cityKey) ?? { total: 0, count: 0 };
    cityBucket.total += row.population_estimate;
    cityBucket.count += 1;
    cityTotals.set(cityKey, cityBucket);

    if (row.county) {
      const countyKey = `${row.state}|${row.county.trim().toLowerCase()}`;
      const countyBucket = countyTotals.get(countyKey) ?? { total: 0, count: 0 };
      countyBucket.total += row.population_estimate;
      countyBucket.count += 1;
      countyTotals.set(countyKey, countyBucket);
    }
  }

  let imputedPopulationCount = 0;
  const filledRows = rows.map((row) => {
    if (row.population_estimate !== null) {
      return row;
    }

    const cityKey = `${row.state}|${row.city.trim().toLowerCase()}`;
    const cityBucket = cityTotals.get(cityKey);
    if (cityBucket && cityBucket.count > 0) {
      imputedPopulationCount += 1;
      return {
        ...row,
        population_estimate: roundPopulation(cityBucket.total / cityBucket.count),
      };
    }

    if (row.county) {
      const countyKey = `${row.state}|${row.county.trim().toLowerCase()}`;
      const countyBucket = countyTotals.get(countyKey);
      if (countyBucket && countyBucket.count > 0) {
        imputedPopulationCount += 1;
        return {
          ...row,
          population_estimate: roundPopulation(countyBucket.total / countyBucket.count),
        };
      }
    }

    return row;
  });

  return {
    rows: filledRows,
    imputedPopulationCount,
  };
}

export function buildGeoZipReferenceDataset(
  text: string,
  zipPopulations: ZipPopulationMap = new Map()
): {
  rows: GeoZipReferenceImportRow[];
  stats: GeoZipImportStats;
} {
  const rawRows = parseRawGeoZipRows(text);
  const grouped = new Map<string, RawGeoZipRow[]>();

  for (const rawRow of rawRows) {
    const normalizedZip = normalizeZip(rawRow.postalCode);
    if (!normalizedZip) {
      continue;
    }
    const existing = grouped.get(normalizedZip) ?? [];
    existing.push(rawRow);
    grouped.set(normalizedZip, existing);
  }

  const rows: GeoZipReferenceImportRow[] = [];
  let validRowCount = 0;

  for (const [zip, candidates] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const selected = [...candidates].sort(compareRows)[0];
    const normalized = normalizeGeoZipRow(selected, zipPopulations);
    if (!normalized) {
      continue;
    }
    validRowCount += candidates.filter(
      (candidate) => normalizeGeoZipRow(candidate, zipPopulations) !== null
    ).length;
    rows.push(normalized);
  }

  const { rows: filledRows, imputedPopulationCount } = fillMissingPopulationEstimates(rows);
  const rawRowCount = rawRows.length;
  const finalRowCount = filledRows.length;
  const duplicateZipCount = [...grouped.values()].filter((entries) => entries.length > 1).length;
  const invalidRowCount = rawRowCount - validRowCount;

  return {
    rows: filledRows,
    stats: {
      rawRowCount,
      validRowCount,
      finalRowCount,
      duplicateZipCount,
      invalidRowCount,
      imputedPopulationCount,
    },
  };
}

async function downloadGeoNamesArchive(): Promise<string> {
  const response = await fetch(GEONAMES_US_ZIP_URL);
  if (!response.ok) {
    throw new Error(`Failed to download GeoNames archive: ${response.status} ${response.statusText}`);
  }

  const tempPath = path.join(os.tmpdir(), `geonames-us-${Date.now()}.zip`);
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(tempPath, Buffer.from(arrayBuffer));
  return tempPath;
}

async function extractUsText(archivePath: string): Promise<string> {
  const { stdout } = await execFileAsync("unzip", ["-p", archivePath, "US.txt"], {
    maxBuffer: 1024 * 1024 * 32,
  });
  return stdout;
}

async function fetchCensusZipPopulations(): Promise<ZipPopulationMap> {
  const response = await fetch(CENSUS_ZCTA_POPULATION_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download Census ZCTA populations: ${response.status} ${response.statusText}`
    );
  }

  const payload = await response.json();
  return buildZipPopulationMapFromCensusResponse(payload);
}

async function insertRows(
  db: DbClient,
  rows: GeoZipReferenceImportRow[]
): Promise<void> {
  for (let index = 0; index < rows.length; index += IMPORT_BATCH_SIZE) {
    const batch = rows.slice(index, index + IMPORT_BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((row, rowIndex) => {
      const offset = rowIndex * 7;
      values.push(
        row.zip_code,
        row.city,
        row.state,
        row.county,
        row.latitude,
        row.longitude,
        row.population_estimate
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
    });

    await db.query(
      `INSERT INTO geo_zip_reference
       (zip_code, city, state, county, latitude, longitude, population_estimate)
       VALUES ${placeholders.join(", ")}`,
      values
    );
  }
}

export async function importGeoZipReferenceIntoDb(
  db: DbClient
): Promise<GeoZipImportStats> {
  let archivePath: string | null = null;

  try {
    archivePath = await downloadGeoNamesArchive();
    const rawText = await extractUsText(archivePath);
    const zipPopulations = await fetchCensusZipPopulations();
    const { rows, stats } = buildGeoZipReferenceDataset(rawText, zipPopulations);

    await db.query("BEGIN");
    try {
      await db.query("TRUNCATE geo_zip_reference");
      await insertRows(db, rows);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    return stats;
  } finally {
    if (archivePath) {
      await fs.rm(archivePath, { force: true });
    }
  }
}

async function importGeoZipReference(): Promise<void> {
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);

  try {
    const stats = await importGeoZipReferenceIntoDb(db);
    console.log(`Geo ZIP raw rows: ${stats.rawRowCount}`);
    console.log(`Geo ZIP valid rows: ${stats.validRowCount}`);
    console.log(`Geo ZIP final rows: ${stats.finalRowCount}`);
    console.log(`Geo ZIP duplicate ZIPs: ${stats.duplicateZipCount}`);
    console.log(`Geo ZIP invalid rows: ${stats.invalidRowCount}`);
    console.log(`Geo ZIP imputed population rows: ${stats.imputedPopulationCount}`);
  } finally {
    await db.end();
  }
}

if (
  process.argv[1]?.endsWith("import-geo-zip-reference.ts") ||
  process.argv[1]?.endsWith("import-geo-zip-reference.js")
) {
  importGeoZipReference().catch((error) => {
    console.error("Geo ZIP import failed:", error);
    process.exit(1);
  });
}

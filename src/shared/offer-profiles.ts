import { z } from "zod/v4";
import type { DbClient } from "./db/client.js";
import { normalizeNiche } from "./cache-policy.js";

const ServiceScopeSchema = z.enum([
  "mixed",
  "residential_only",
  "commercial_only",
]);

export const OfferConstraintSchema = z.object({
  service_scope: ServiceScopeSchema.default("mixed"),
  allowed_services: z.array(z.string()).default([]),
  disallowed_services: z.array(z.string()).default([]),
  banned_phrases: z.array(z.string()).default([]),
  required_disclaimer: z.string().default(""),
  allowed_traffic: z.array(z.string()).default([]),
  prohibited_traffic: z.array(z.string()).default([]),
  target_call_min_duration_seconds: z.number().int().nullable().default(null),
  target_call_max_duration_seconds: z.number().int().nullable().default(null),
  target_geo_sources: z.array(z.string()).default([]),
});

export const OfferProfileSchema = z.object({
  offer_id: z.string().min(1),
  niche: z.string().min(1),
  vertical: z.string().min(1),
  raw_offer_text: z.string().min(1),
  constraints: OfferConstraintSchema,
});

export type OfferConstraints = z.infer<typeof OfferConstraintSchema>;
export type OfferProfile = z.infer<typeof OfferProfileSchema>;

function uniqNormalized(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function titleToSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function detectVertical(rawOfferText: string): string {
  const lower = rawOfferText.toLowerCase();
  if (lower.includes("pest control")) {
    return "pest-control";
  }
  if (lower.includes("hvac")) {
    return "hvac";
  }
  if (lower.includes("plumbing")) {
    return "plumbing";
  }
  return "local-service";
}

function extractQuotedPhrases(section: string): string[] {
  return [...section.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim());
}

function extractListAfterLabel(rawOfferText: string, label: string): string[] {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*:?\\s*([^\\n]+)`, "i");
  const match = rawOfferText.match(pattern);
  if (!match) {
    return [];
  }
  return match[1]
    .split(/[,\u2022]| - /g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractExampleServices(rawOfferText: string): string[] {
  const match = rawOfferText.match(/Example list:\s*\(([^)]+)\)/i);
  if (!match) {
    return [];
  }
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(titleToSlug);
}

function extractDisallowedServices(rawOfferText: string): string[] {
  const match = rawOfferText.match(
    /Definition of an unqualified call:\s*([^*]+?)(?:\n\s*\*|$)/i
  );
  if (!match) {
    return [];
  }

  const section = match[1]
    .replace(/\bNo\b/gi, "")
    .replace(/\bNO\b/gi, "")
    .replace(/\bcalls?\b/gi, "")
    .replace(/\./g, ",");

  return uniqNormalized(
    section
      .split(/[,\n]/g)
      .map((item) =>
        item
          .replace(/^[^a-z0-9]+/i, "")
          .replace(/\s+of any kind$/i, "")
          .trim()
      )
      .filter(Boolean)
      .map(titleToSlug)
  );
}

function extractBannedPhrases(rawOfferText: string): string[] {
  const restrictedLine = rawOfferText.match(/\*\*Restricted:\s*([^\n]+)/i)?.[1] ?? "";
  const quoted = extractQuotedPhrases(restrictedLine);
  return uniqNormalized(quoted);
}

function extractDisclaimer(rawOfferText: string): string {
  const match = rawOfferText.match(/Disclaimer:\s*([\s\S]+)$/i);
  return match?.[1]?.trim() ?? "";
}

function detectServiceScope(rawOfferText: string): OfferConstraints["service_scope"] {
  const lower = rawOfferText.toLowerCase();
  const residentialSignals = [
    "only apartments",
    "houses or family homes",
    "no commercial buildings",
  ].every((phrase) => lower.includes(phrase));

  if (residentialSignals) {
    return "residential_only";
  }

  if (lower.includes("no residential")) {
    return "commercial_only";
  }

  return "mixed";
}

function extractCallDuration(rawOfferText: string): {
  min: number | null;
  max: number | null;
} {
  const match = rawOfferText.match(/Minimal call duration:\s*(\d+)\s*-\s*(\d+)\s*sec/i);
  if (!match) {
    return { min: null, max: null };
  }
  return {
    min: Number(match[1]),
    max: Number(match[2]),
  };
}

function extractGeoSources(rawOfferText: string): string[] {
  return uniqNormalized(
    [...rawOfferText.matchAll(/https:\/\/docs\.google\.com\/spreadsheets\/[^\s)]+/gi)].map(
      (match) => match[0]
    )
  );
}

export function parseOfferProfile(
  offerId: string,
  rawOfferText: string
): OfferProfile {
  const vertical = detectVertical(rawOfferText);
  const niche = normalizeNiche(vertical);
  const callDuration = extractCallDuration(rawOfferText);

  const profile: OfferProfile = {
    offer_id: offerId.trim(),
    niche,
    vertical,
    raw_offer_text: rawOfferText.trim(),
    constraints: {
      service_scope: detectServiceScope(rawOfferText),
      allowed_services: extractExampleServices(rawOfferText),
      disallowed_services: extractDisallowedServices(rawOfferText),
      banned_phrases: extractBannedPhrases(rawOfferText),
      required_disclaimer: extractDisclaimer(rawOfferText),
      allowed_traffic: uniqNormalized(extractListAfterLabel(rawOfferText, "Allowed types of traffic")),
      prohibited_traffic: uniqNormalized(extractListAfterLabel(rawOfferText, "Prohibited types of traffic")),
      target_call_min_duration_seconds: callDuration.min,
      target_call_max_duration_seconds: callDuration.max,
      target_geo_sources: extractGeoSources(rawOfferText),
    },
  };

  return OfferProfileSchema.parse(profile);
}

function normalizeZip(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  return digits.slice(0, 5).padStart(5, "0");
}

function parseZipCsv(csvText: string): string[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const firstCell = lines[0].split(",")[0].trim().replace(/^"|"$/g, "");
  const hasHeader = !/^\d{1,5}$/.test(firstCell);
  const seen = new Set<string>();
  const zips: string[] = [];

  for (const line of hasHeader ? lines.slice(1) : lines) {
    const firstColumn = line.split(",")[0].trim().replace(/^"|"$/g, "");
    const zip = normalizeZip(firstColumn);
    if (!zip || seen.has(zip)) {
      continue;
    }
    seen.add(zip);
    zips.push(zip);
  }

  return zips;
}

export async function saveOfferProfile(
  db: DbClient,
  profile: OfferProfile
): Promise<void> {
  await db.query(
    `INSERT INTO offer_profiles (offer_id, niche, vertical, raw_offer_text, constraints, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (offer_id) DO UPDATE SET
       niche = EXCLUDED.niche,
       vertical = EXCLUDED.vertical,
       raw_offer_text = EXCLUDED.raw_offer_text,
       constraints = EXCLUDED.constraints,
       updated_at = now()`,
    [
      profile.offer_id,
      profile.niche,
      profile.vertical,
      profile.raw_offer_text,
      JSON.stringify(profile.constraints),
    ]
  );
}

export async function parseAndSaveOfferProfile(
  db: DbClient,
  offerId: string,
  rawOfferText: string
): Promise<OfferProfile> {
  const profile = parseOfferProfile(offerId, rawOfferText);
  await saveOfferProfile(db, profile);
  return profile;
}

export async function loadOfferProfile(
  db: DbClient,
  offerId: string
): Promise<OfferProfile | null> {
  const result = await db.query<{
    offer_id: string;
    niche: string;
    vertical: string;
    raw_offer_text: string;
    constraints: unknown;
  }>(
    `SELECT offer_id, niche, vertical, raw_offer_text, constraints
     FROM offer_profiles
     WHERE offer_id = $1
     LIMIT 1`,
    [offerId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return OfferProfileSchema.parse({
    ...row,
    constraints:
      typeof row.constraints === "string"
        ? JSON.parse(row.constraints)
        : row.constraints,
  });
}

export async function syncOfferGeoCoverageFromProfile(
  db: DbClient,
  offerId: string
): Promise<number> {
  const profile = await loadOfferProfile(db, offerId);
  if (!profile || profile.constraints.target_geo_sources.length === 0) {
    return 0;
  }

  const allZips = new Set<string>();
  for (const sourceUrl of profile.constraints.target_geo_sources) {
    const exportUrl = sourceUrl.includes("/export?format=csv")
      ? sourceUrl
      : sourceUrl.replace(/\/edit.*$/i, "/export?format=csv");
    const response = await fetch(exportUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch offer ZIP source: ${response.status} ${response.statusText}`);
    }
    const zips = parseZipCsv(await response.text());
    for (const zip of zips) {
      allZips.add(zip);
    }
  }

  const zipList = [...allZips];
  if (zipList.length === 0) {
    return 0;
  }

  const writer = async (tx: DbClient) => {
    await tx.query("DELETE FROM offer_geo_coverage WHERE offer_id = $1", [offerId]);
    for (const zip of zipList) {
      await tx.query(
        `INSERT INTO offer_geo_coverage (offer_id, zip_code, source)
         VALUES ($1, $2, $3)`,
        [offerId, zip, "offer-profile"]
      );
    }
  };

  if (db.withTransaction) {
    await db.withTransaction(writer);
  } else {
    await writer(db);
  }

  return zipList.length;
}

export function serviceSlugToLabel(service: string): string {
  return service
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

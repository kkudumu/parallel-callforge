import "dotenv/config";
import { getEnv } from "../../config/env.js";
import { createDbClient } from "./client.js";

interface OfferImportSpec {
  offerId: string;
  url: string;
  source: string;
}

const OFFER_SHEETS: OfferImportSpec[] = [
  {
    offerId: "pest-control-tier-1",
    url: "https://docs.google.com/spreadsheets/d/14tfAgIgF7KNPHHbsHb3ImTSs5TFAq_WWpNK9x1xSDqA/export?format=csv",
    source: "google-sheet:tier-1",
  },
  {
    offerId: "pest-control-tier-2",
    url: "https://docs.google.com/spreadsheets/d/11-Z0OgDCAJEssNgN93_Y9Whl8405YETyqBFio3aSXbw/export?format=csv",
    source: "google-sheet:tier-2",
  },
  {
    offerId: "pest-control-tier-3-buyer-1",
    url: "https://docs.google.com/spreadsheets/d/1xAV99d2YvNHlYvxuc6NJxqoPYBHNdJGdMHAbI6I9rDc/export?format=csv",
    source: "google-sheet:tier-3-buyer-1",
  },
  {
    offerId: "pest-control-tier-3-buyer-2",
    url: "https://docs.google.com/spreadsheets/d/1bLaeH7QP6b7Ir9YUNr54WS5WUHn8SPOm2KEFWcTItjw/export?format=csv",
    source: "google-sheet:tier-3-buyer-2",
  },
];

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
    .filter((line) => line.length > 0);

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

async function importOffer(db: ReturnType<typeof createDbClient>, offer: OfferImportSpec): Promise<number> {
  const response = await fetch(offer.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${offer.offerId}: ${response.status} ${response.statusText}`);
  }

  const zips = parseZipCsv(await response.text());
  if (zips.length === 0) {
    throw new Error(`No ZIPs parsed for ${offer.offerId}`);
  }

  const writeOffer = async (writer: ReturnType<typeof createDbClient>) => {
    await writer.query("DELETE FROM offer_geo_coverage WHERE offer_id = $1", [offer.offerId]);
    for (const zip of zips) {
      await writer.query(
        `INSERT INTO offer_geo_coverage (offer_id, zip_code, source)
         VALUES ($1, $2, $3)`,
        [offer.offerId, zip, offer.source]
      );
    }
  };

  if (db.withTransaction) {
    await db.withTransaction(writeOffer);
  } else {
    await writeOffer(db);
  }

  return zips.length;
}

async function main() {
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);

  try {
    for (const offer of OFFER_SHEETS) {
      const count = await importOffer(db, offer);
      console.log(`${offer.offerId}: ${count} ZIPs imported`);
    }
    console.log("Pest-control offer imports complete.");
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Pest-control offer import failed:", error);
  process.exit(1);
});

import { URL } from "node:url";

function normalizeExtFromContentType(contentType: string | null): string {
  const value = (contentType ?? "").toLowerCase();
  if (value.includes("image/png")) return "png";
  if (value.includes("image/webp")) return "webp";
  if (value.includes("image/avif")) return "avif";
  return "jpg";
}

function normalizeExtFromUrl(rawUrl: string): string | null {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]+)$/);
    if (!match) return null;
    const ext = match[1];
    if (["jpg", "jpeg", "png", "webp", "avif"].includes(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {
    return null;
  }
  return null;
}

function buildQueries(pageType: "city_hub" | "service_subpage", city: string, pestType?: string): string[] {
  const base = [
    "pest control technician home inspection",
    "exterminator technician exterior home",
  ];

  if (pageType === "city_hub") {
    return [
      `${city} pest control technician`,
      `${city} exterminator service`,
      ...base,
    ];
  }

  const pest = (pestType ?? "pest").trim();
  const lower = pest.toLowerCase();
  if (lower.includes("termite")) {
    return [
      "termite inspection technician",
      "pest control technician crawl space inspection",
      ...base,
    ];
  }
  if (lower.includes("bed")) {
    return [
      "pest control technician bedroom inspection",
      "mattress inspection technician",
      ...base,
    ];
  }
  if (lower.includes("rodent") || lower.includes("rat") || lower.includes("mouse") || lower.includes("wildlife")) {
    return [
      "rodent control technician attic inspection",
      "wildlife removal technician home exterior",
      ...base,
    ];
  }
  return [
    `${pest} control technician`,
    "pest control technician spraying exterior home",
    ...base,
  ];
}

async function fetchPexelsImage(query: string, apiKey: string): Promise<string | null> {
  const endpoint = new URL("https://api.pexels.com/v1/search");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("per_page", "5");
  endpoint.searchParams.set("orientation", "landscape");

  const response = await fetch(endpoint, {
    headers: {
      Authorization: apiKey,
    },
  });
  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    photos?: Array<{
      width?: number;
      height?: number;
      src?: {
        large2x?: string;
        large?: string;
        original?: string;
      };
    }>;
  };

  const photo = (data.photos ?? [])
    .filter((item) => (item.width ?? 0) >= (item.height ?? 0))
    .at(0) ?? data.photos?.[0];

  return photo?.src?.large2x ?? photo?.src?.large ?? photo?.src?.original ?? null;
}

async function fetchPixabayImage(query: string, apiKey: string): Promise<string | null> {
  const endpoint = new URL("https://pixabay.com/api/");
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("image_type", "photo");
  endpoint.searchParams.set("orientation", "horizontal");
  endpoint.searchParams.set("safesearch", "true");
  endpoint.searchParams.set("per_page", "5");

  const response = await fetch(endpoint);
  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    hits?: Array<{
      largeImageURL?: string;
      webformatURL?: string;
    }>;
  };
  const hit = data.hits?.[0];
  return hit?.largeImageURL ?? hit?.webformatURL ?? null;
}

async function downloadBinary(rawUrl: string): Promise<{ bytes: Buffer; ext: string } | null> {
  const response = await fetch(rawUrl);
  if (!response.ok) {
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  const ext =
    normalizeExtFromUrl(rawUrl) ||
    normalizeExtFromContentType(response.headers.get("content-type"));
  return {
    bytes: Buffer.from(arrayBuffer),
    ext,
  };
}

export async function fetchStockImageAsset(options: {
  pageType: "city_hub" | "service_subpage";
  city: string;
  pestType?: string;
}): Promise<{ bytes: Buffer; ext: string } | null> {
  const pexelsKey = process.env.PEXELS_API_KEY?.trim();
  const pixabayKey = process.env.PIXABAY_API_KEY?.trim();
  if (!pexelsKey && !pixabayKey) {
    return null;
  }

  const queries = buildQueries(options.pageType, options.city, options.pestType);

  for (const query of queries) {
    try {
      if (pexelsKey) {
        const pexelsUrl = await fetchPexelsImage(query, pexelsKey);
        if (pexelsUrl) {
          const asset = await downloadBinary(pexelsUrl);
          if (asset) {
            return asset;
          }
        }
      }
    } catch {
      // Fall through to next provider/query.
    }

    try {
      if (pixabayKey) {
        const pixabayUrl = await fetchPixabayImage(query, pixabayKey);
        if (pixabayUrl) {
          const asset = await downloadBinary(pixabayUrl);
          if (asset) {
            return asset;
          }
        }
      }
    } catch {
      // Fall through to next query.
    }
  }

  return null;
}

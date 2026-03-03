import { z } from "zod/v4";
import fs from "node:fs";
import path from "node:path";
import type Bottleneck from "bottleneck";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { createHugoManager } from "./hugo-manager.js";
import { BANNED_PHRASES, findPlaceholderTokens, runQualityGate, type SectionRule, type PageMetadata } from "./quality-gate.js";
import { fetchStockImageAsset, hasStockImageProviderKeys } from "./image-sourcing.js";
import { reviewGeneratedHugoTemplates } from "./template-review.js";
import { slugify } from "../agent-1-keywords/index.js";
import { eventBus } from "../../shared/events/event-bus.js";
import {
  buildCheckpointScope,
  createCheckpointTracker,
} from "../../shared/checkpoints.js";
import type { OfferProfile } from "../../shared/offer-profiles.js";
import { serviceSlugToLabel } from "../../shared/offer-profiles.js";
import type { VerticalProfile } from "../../shared/vertical-profiles.js";
import { resolveVerticalStrategy } from "../../shared/vertical-strategies.js";
import { HUGO_TEMPLATE_PROMPT } from "./prompts.js";
import type { DesignSpec } from "../../shared/schemas/design-specs.js";
import type { CopyFramework } from "../../shared/schemas/copy-frameworks.js";
import {
  computeCacheFingerprint,
  normalizeNiche,
} from "../../shared/cache-policy.js";

const ContentResponseSchema = z.object({
  title: z.string(),
  meta_description: z.string(),
  content: z.string().min(100),
  headings: z.array(z.string()).optional(),
  faq: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })).optional(),
});

const HugoTemplateResponseSchema = z.object({
  baseof: z.string().min(50),
  city_hub: z.string().min(50),
  service_subpage: z.string().min(50),
});

export interface Agent3Config {
  niche: string;
  offerProfile?: OfferProfile | null;
  verticalProfile?: VerticalProfile | null;
  hugoSitePath: string;
  phone: string;
  minWordCountHub: number;
  minWordCountSubpage: number;
  deployLimiter?: Bottleneck;
  maxNewCitiesPerWeek?: number;
  enforceNewCityCap?: boolean;
  targetCities?: string[];
  indexationKillSwitchEnabled?: boolean;
  searchConsoleIntegrationEnabled?: boolean;
  indexationMinPageAgeDays?: number;
  indexationLookbackDays?: number;
  minIndexationRatio?: number;
  ignoreIndexationKillSwitch?: boolean;
}

const DEFAULT_CONFIG: Partial<Agent3Config> = {
  phone: process.env.BUSINESS_PHONE ?? "(555) 123-4567",
  minWordCountHub: 800,
  minWordCountSubpage: 1200,
  maxNewCitiesPerWeek: 3,
  enforceNewCityCap: false,
  indexationKillSwitchEnabled: false,
  searchConsoleIntegrationEnabled: false,
  indexationMinPageAgeDays: 21,
  indexationLookbackDays: 30,
  minIndexationRatio: 0.5,
};

const AGENT3_TEMPLATE_TIMEOUT_MS = 180_000;
const AGENT3_CONTENT_TIMEOUT_MS = 300_000;
const AGENT3_SUBPAGE_CONCURRENCY = 2;

async function getLimiterSnapshot(limiter: Bottleneck): Promise<{
  queued: number;
  reservoir: number | "unknown";
}> {
  let reservoir: number | "unknown" = "unknown";
  try {
    const value = await limiter.currentReservoir();
    if (typeof value === "number") {
      reservoir = value;
    }
  } catch {
    reservoir = "unknown";
  }

  return {
    queued: limiter.queued(),
    reservoir,
  };
}

async function scheduleWithVerboseLimiter<T>(
  limiter: Bottleneck | undefined,
  label: string,
  task: () => Promise<T>
): Promise<T> {
  if (!limiter) {
    return task();
  }

  const before = await getLimiterSnapshot(limiter);
  console.log(
    `[Agent 3] Waiting for deploy limiter slot for ${label} (queued=${before.queued}, reservoir=${before.reservoir})`
  );
  if (before.reservoir === 0) {
    console.warn(
      `[Agent 3] Deploy limiter reservoir is exhausted before ${label}; execution will pause until the limiter refreshes.`
    );
  }

  return limiter.schedule(async () => {
    const acquired = await getLimiterSnapshot(limiter);
    console.log(
      `[Agent 3] Acquired deploy limiter slot for ${label} (queued=${acquired.queued}, reservoir=${acquired.reservoir})`
    );
    return task();
  });
}

function createVerboseProviderLogger(prefix: string) {
  const partials: Record<"stdout" | "stderr", string> = {
    stdout: "",
    stderr: "",
  };

  const emitLine = (line: string, stream: "stdout" | "stderr") => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (stream === "stderr") {
      console.warn(`${prefix} [raw][stderr] ${trimmed}`);
    } else {
      console.log(`${prefix} [raw] ${trimmed}`);
    }
  };

  return {
    onOutput(chunk: string, stream: "stdout" | "stderr") {
      const combined = partials[stream] + chunk;
      const lines = combined.split(/\r?\n/);
      partials[stream] = lines.pop() ?? "";

      for (const line of lines) {
        emitLine(line, stream);
      }
    },
    flush() {
      for (const stream of ["stdout", "stderr"] as const) {
        emitLine(partials[stream], stream);
        partials[stream] = "";
      }
    },
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      await worker(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

interface DesignSystemContext {
  designSpec: DesignSpec;
  copyFramework: CopyFramework;
  schemaTemplates: Record<string, unknown>;
  seasonalCalendar: Array<{
    month: number;
    name: string;
    primary_pests: string[];
    content_topics: string[];
    messaging_priority: string;
    seasonal_keywords: string[];
  }>;
  primary: string;
  secondary: string;
  tertiary: string;
  highlight: string;
  headingFont: string;
  bodyFont: string;
  heroHeadline: string;
  secondaryHeadline: string;
  primaryCta: string;
  secondaryCta: string;
  ctaMicrocopy: string[];
  guarantees: string[];
  readingLevel: {
    target_grade_min: number;
    target_grade_max: number;
    tone: string;
    banned_phrases: string[];
  };
  verticalAngles: {
    general_pest: string;
    termites: string;
    bed_bugs: string;
    wildlife_rodents: string;
    ants?: string;
    spiders?: string;
    cockroaches?: string;
    mosquitoes?: string;
  };
  trustSignals: string[];
  faqLead: { question: string; answer_template: string } | null;
}

type SiteBuildStatus =
  | "QUEUED"
  | "GENERATING_CONTENT"
  | "BUILDING"
  | "QA_CHECK"
  | "DEPLOYING_DRAFT"
  | "DEPLOYING_LIVE"
  | "LIVE"
  | "FAILED";

async function createSiteBuildRecord(
  db: DbClient,
  config: Agent3Config
): Promise<{ id: string; siteKey: string; buildNumber: number }> {
  const siteKey = normalizeNiche(config.niche);
  const nextBuildNumberResult = await db.query<{ next_build_number: string }>(
    `SELECT (COALESCE(MAX(build_number), 0) + 1)::text AS next_build_number
     FROM site_builds
     WHERE site_key = $1`,
    [siteKey]
  );
  const buildNumber = Number(nextBuildNumberResult.rows[0]?.next_build_number ?? "1");
  const insertResult = await db.query<{ id: string }>(
    `INSERT INTO site_builds (site_key, niche, build_number, status, target_cities)
     VALUES ($1, $2, $3, 'QUEUED', $4::jsonb)
     RETURNING id`,
    [
      siteKey,
      config.niche,
      buildNumber,
      JSON.stringify(config.targetCities ?? []),
    ]
  );

  return {
    id: insertResult.rows[0].id,
    siteKey,
    buildNumber,
  };
}

async function updateSiteBuildRecord(
  db: DbClient,
  buildId: string,
  status: SiteBuildStatus,
  options: {
    error?: string;
    buildOutput?: Record<string, unknown>;
    draftUrl?: string;
    liveUrl?: string;
    completed?: boolean;
  } = {}
): Promise<void> {
  await db.query(
    `UPDATE site_builds
     SET status = $2,
         errors = CASE
           WHEN $3::jsonb IS NULL THEN errors
           ELSE errors || $3::jsonb
         END,
         build_output = COALESCE(build_output, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb),
         draft_url = COALESCE($5, draft_url),
         live_url = COALESCE($6, live_url),
         updated_at = now(),
         completed_at = CASE
           WHEN $7::boolean THEN now()
           ELSE completed_at
         END
     WHERE id = $1`,
    [
      buildId,
      status,
      options.error ? JSON.stringify([options.error]) : null,
      options.buildOutput ? JSON.stringify(options.buildOutput) : null,
      options.draftUrl ?? null,
      options.liveUrl ?? null,
      options.completed ?? false,
    ]
  );
}

function collectFilesRecursive(root: string, matcher: (filePath: string) => boolean): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursive(fullPath, matcher));
      continue;
    }
    if (matcher(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function runBuiltArtifactQa(
  hugoSitePath: string,
  citySlugs: string[] = []
): { passed: boolean; failures: string[] } {
  const publicDir = path.join(hugoSitePath, "public");
  const normalizedCitySlugs = [...new Set(citySlugs.map((slug) => slug.trim()).filter(Boolean))];
  const htmlFiles =
    normalizedCitySlugs.length > 0
      ? normalizedCitySlugs.flatMap((slug) =>
          collectFilesRecursive(
            path.join(publicDir, slug),
            (filePath) => filePath.endsWith(".html")
          )
        )
      : collectFilesRecursive(publicDir, (filePath) => filePath.endsWith(".html"));
  const failures: string[] = [];

  if (htmlFiles.length === 0) {
    failures.push("no_built_html");
    return { passed: false, failures };
  }

  const placeholdersFound = findPlaceholderTokens(
    htmlFiles.map((filePath) => fs.readFileSync(filePath, "utf-8"))
  );
  if (placeholdersFound.length > 0) {
    failures.push(`placeholder_tokens:${placeholdersFound.join(",")}`);
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

async function repairContentForQa(
  llm: LlmClient,
  options: {
    prompt: string;
    content: z.infer<typeof ContentResponseSchema>;
    city: string;
    minWordCount: number;
    supplementalTexts: string[];
    failures: string[];
    bannedPhrasesFound?: string[];
    logLabel: string;
    replacements: Record<string, string>;
  }
): Promise<{
  content: z.infer<typeof ContentResponseSchema>;
  quality: ReturnType<typeof runQualityGate>;
}> {
  const repairPrompt = `${options.prompt}

You previously returned content that failed QA with these failures:
${options.failures.join(", ")}

Return a corrected JSON response using the same schema.

Hard requirements:
- Remove all placeholder tokens such as [TOKEN], {token}, TODO, or similar markers.
- Replace placeholders with concrete copy, not blanks.
- Keep the city name "${options.city}" naturally present in the body copy.
- Keep the body content at or above ${options.minWordCount} words.
- Preserve the same page intent and local-business framing.
- Remove AI-sounding boilerplate phrases such as: ${BANNED_PHRASES.join(", ")}.
- If any specific banned phrases were detected, remove them completely: ${(options.bannedPhrasesFound ?? []).join(", ") || "none detected"}.
- Rewrite any sentence that contains a banned phrase instead of making a minimal token swap.
- Do not include explanations, only the corrected structured response.

Previous structured response:
${JSON.stringify(options.content, null, 2)}`;

  const repairLogger = createVerboseProviderLogger(options.logLabel);
  let repairedContent;
  try {
    repairedContent = await llm.call({
      prompt: repairPrompt,
      schema: ContentResponseSchema,
      model: "sonnet",
      timeoutMs: AGENT3_CONTENT_TIMEOUT_MS,
      logLabel: options.logLabel,
      onOutput: (chunk, stream) => repairLogger.onOutput(chunk, stream),
    });
  } finally {
    repairLogger.flush();
  }
  const normalizedRepairedContent = resolveGeneratedContentPlaceholders(
    repairedContent,
    options.replacements
  );

  const repairedQuality = runQualityGate(
    normalizedRepairedContent.content,
    options.city,
    options.minWordCount,
    [
      normalizedRepairedContent.title,
      normalizedRepairedContent.meta_description,
      ...options.supplementalTexts,
    ]
  );

  return {
    content: normalizedRepairedContent,
    quality: repairedQuality,
  };
}

async function runDraftPreviewQa(draftUrl: string): Promise<void> {
  const response = await fetch(draftUrl);
  if (!response.ok) {
    throw new Error(`Draft preview QA failed with HTTP ${response.status}`);
  }

  const html = await response.text();
  const placeholdersFound = findPlaceholderTokens([html]);
  if (placeholdersFound.length > 0) {
    throw new Error(`Draft preview contains placeholder tokens: ${placeholdersFound.join(", ")}`);
  }
}

function resolveGeneratedContentPlaceholders(
  content: z.infer<typeof ContentResponseSchema>,
  replacements: Record<string, string>
): z.infer<typeof ContentResponseSchema> {
  const replaceString = (value: string): string =>
    value
      .replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => replacements[key] ?? "")
      .replace(/\[([A-Z0-9_ -]+)\]/g, (_match, key: string) => {
        const normalizedKey = key.toLowerCase().replace(/[ -]+/g, "_");
        return replacements[normalizedKey] ?? "";
      });

  return {
    ...content,
    title: replaceString(content.title),
    meta_description: replaceString(content.meta_description),
    content: replaceString(content.content),
    headings: content.headings?.map((heading) => replaceString(heading)),
    faq: content.faq?.map((item) => ({
      question: replaceString(item.question),
      answer: replaceString(item.answer),
    })),
  };
}

function canAutoRepairQaFailures(failures: string[]): boolean {
  const repairableFailures = new Set([
    "placeholder_tokens",
    "banned_phrases",
  ]);

  return failures.length > 0 && failures.every((failure) => repairableFailures.has(failure));
}

function asObject<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") {
    return value as T;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function asFaqArray(value: unknown): Array<{ question: string; answer_template: string }> {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is { question: string; answer_template: string } =>
        Boolean(
          item &&
          typeof item === "object" &&
          typeof (item as any).question === "string" &&
          typeof (item as any).answer_template === "string"
        )
    );
  }

  if (typeof value === "string") {
    try {
      return asFaqArray(JSON.parse(value));
    } catch {
      return [];
    }
  }

  return [];
}

function asSeasonalMonths(value: unknown): Array<{
  month: number;
  name: string;
  primary_pests: string[];
  content_topics: string[];
  messaging_priority: string;
  seasonal_keywords: string[];
  region_overrides?: Array<{ region: string; notes: string[] }>;
}> {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === "object")
      .map((item: any) => ({
        month: typeof item.month === "number" ? item.month : 0,
        name: typeof item.name === "string" ? item.name : "",
        primary_pests: Array.isArray(item.primary_pests)
          ? item.primary_pests.filter((entry: unknown): entry is string => typeof entry === "string")
          : [],
        content_topics: Array.isArray(item.content_topics)
          ? item.content_topics.filter((entry: unknown): entry is string => typeof entry === "string")
          : [],
        messaging_priority: typeof item.messaging_priority === "string" ? item.messaging_priority : "",
        seasonal_keywords: Array.isArray(item.seasonal_keywords)
          ? item.seasonal_keywords.filter((entry: unknown): entry is string => typeof entry === "string")
          : [],
        region_overrides: Array.isArray(item.region_overrides)
          ? item.region_overrides.filter((r: any) => r && typeof r.region === "string")
          : undefined,
      }))
      .filter((item) => item.name);
  }

  if (typeof value === "string") {
    try {
      return asSeasonalMonths(JSON.parse(value));
    } catch {
      return [];
    }
  }

  return [];
}

const PEST_ICON_MAP: Record<string, string> = {
  ants: "🐜",
  ant: "🐜",
  spiders: "🕷️",
  spider: "🕷️",
  cockroaches: "🪳",
  cockroach: "🪳",
  roach: "🪳",
  termites: "🪵",
  termite: "🪵",
  mice: "🐭",
  mouse: "🐭",
  rats: "🐀",
  rat: "🐀",
  rodent: "🐀",
  "rodent-control": "🐀",
  silverfish: "🐛",
  earwigs: "🪲",
  earwig: "🪲",
  centipedes: "🐛",
  centipede: "🐛",
  millipedes: "🐛",
  millipede: "🐛",
  "bed-bugs": "🛏️",
  "bed-bug": "🛏️",
  moths: "🦋",
  moth: "🦋",
  "clothes-moths": "🦋",
  crickets: "🦗",
  cricket: "🦗",
  "house-crickets": "🦗",
  fleas: "🔬",
  flea: "🔬",
  mosquitoes: "🦟",
  mosquito: "🦟",
  wasps: "🐝",
  wasp: "🐝",
  bees: "🐝",
  bee: "🐝",
};

function getPestIcon(pestSlug: string): string {
  const normalized = pestSlug.toLowerCase().replace(/[^a-z-]/g, "");
  if (PEST_ICON_MAP[normalized]) {
    return PEST_ICON_MAP[normalized];
  }
  // Try matching partial keys
  for (const [key, icon] of Object.entries(PEST_ICON_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return icon;
    }
  }
  return "🛡️";
}

function getPestDescription(pestName: string): string {
  const lower = pestName.toLowerCase();
  if (lower.includes("ant")) return "Fast-acting ant control for homes and yards.";
  if (lower.includes("spider")) return "Safe spider removal for families and pets.";
  if (lower.includes("cockroach") || lower.includes("roach")) return "Thorough cockroach elimination and prevention.";
  if (lower.includes("termite")) return "Protect your home from termite damage.";
  if (lower.includes("rodent") || lower.includes("mouse") || lower.includes("mice") || lower.includes("rat")) return "Professional rodent control and exclusion.";
  if (lower.includes("silverfish")) return "Targeted silverfish treatment for your home.";
  if (lower.includes("bed bug") || lower.includes("bed-bug")) return "Complete bed bug elimination services.";
  if (lower.includes("mosquito")) return "Reduce mosquito populations around your property.";
  if (lower.includes("flea")) return "Effective flea treatment for homes with pets.";
  if (lower.includes("wasp") || lower.includes("bee")) return "Safe removal of stinging insect nests.";
  if (lower.includes("moth")) return "Moth control for closets and pantries.";
  if (lower.includes("cricket")) return "Cricket removal to restore quiet in your home.";
  if (lower.includes("earwig")) return "Earwig control inside and outside your home.";
  if (lower.includes("centipede") || lower.includes("millipede")) return "Centipede and millipede removal services.";
  return `Professional ${pestName.toLowerCase()} control services.`;
}

function resolveHeadlineFormula(
  formula: string,
  city: string,
  state: string,
  service: string,
  phone: string
): string {
  return formula
    .replace(/\[City\]/gi, city)
    .replace(/\{city\}/gi, city)
    .replace(/\[State\]/gi, state)
    .replace(/\{state\}/gi, state)
    .replace(/\[Service\]/gi, service)
    .replace(/\{service\}/gi, service)
    .replace(/\[Phone\]/gi, phone)
    .replace(/\{phone\}/gi, phone)
    .replace(/\[Benefit\]/gi, "Fast & Reliable Service");
}

function generateTestimonials(
  city: string,
  pestType: string | undefined,
  copyFramework: CopyFramework,
  hasLicense: boolean
): Array<{ stars: string; rating: string; text: string; author: string; city: string }> {
  const firstNames = ["Sarah", "Mike", "Jennifer", "David", "Lisa", "James", "Maria", "Robert"];
  const lastInitials = ["M", "T", "R", "K", "L", "S", "W", "P"];
  const serviceLabel = pestType ? serviceSlugToLabel(pestType) : "pest control";
  const trustAngle = hasLicense ? "licensed and insured" : "professional";
  const guaranteeMention = copyFramework.guarantees[0] || "satisfaction guaranteed";

  const templates = [
    `Called about a ${serviceLabel.toLowerCase()} problem and they had someone out the same day. The technician was ${trustAngle}, thorough, and explained everything. Highly recommend for anyone in ${city}.`,
    `We were dealing with ${serviceLabel.toLowerCase()} issues for weeks before we called. The tech arrived on time, treated the whole house, and we haven't seen a single one since. ${guaranteeMention.charAt(0).toUpperCase() + guaranteeMention.slice(1)}.`,
    `Fast response, fair pricing, and effective treatment. The ${serviceLabel.toLowerCase()} problem in our kitchen is completely gone. Great service for ${city} homeowners.`,
  ];

  return templates.slice(0, 3).map((text, i) => ({
    stars: "★★★★★",
    rating: i === 2 ? "4.8" : "5.0",
    text,
    author: `${firstNames[i % firstNames.length]} ${lastInitials[i % lastInitials.length]}.`,
    city,
  }));
}

// States that require a pest control business license for advertising/operation
const LICENSE_REQUIRED_STATES = new Set([
  "CA", "FL", "TX", "NY", "IL", "PA", "OH", "GA", "NC", "MI",
  "NJ", "VA", "WA", "AZ", "MA", "TN", "IN", "MO", "MD", "WI",
  "CO", "MN", "SC", "AL", "LA", "KY", "OR", "OK", "CT", "UT",
  "IA", "NV", "AR", "MS", "KS", "NM", "NE", "WV", "ID", "HI",
  "NH", "ME", "MT", "RI", "DE", "SD", "ND", "AK", "VT", "WY", "DC",
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function selectColor(colors: Record<string, string>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const match = colors[key];
    if (typeof match === "string" && match.trim().length > 0) {
      return match;
    }
  }

  const first = Object.values(colors).find((value) => typeof value === "string" && value.trim().length > 0);
  return first ?? fallback;
}

function getLayoutLabels(layout: Record<string, unknown>): string[] {
  return Object.keys(layout)
    .map((key) => key.replace(/[_-]+/g, " ").trim())
    .filter(Boolean);
}

function getComponentLabels(components: Array<Record<string, unknown>>): string[] {
  return components
    .map((component) => {
      const name = typeof component.name === "string" ? component.name : "";
      const type = typeof component.type === "string" ? component.type : "";
      return name || type;
    })
    .map((label) => label.replace(/[_-]+/g, " ").trim())
    .filter(Boolean);
}

function createDeterministicImageSvg(
  title: string,
  subtitle: string,
  primary: string,
  secondary: string,
  tertiary: string,
  highlight: string
): string {
  const safeTitle = escapeHtml(title).slice(0, 48);
  const safeSubtitle = escapeHtml(subtitle).slice(0, 64);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${secondary}"/>
      <stop offset="55%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${highlight}"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#bg)"/>
  <circle cx="1320" cy="180" r="220" fill="${tertiary}" fill-opacity="0.18"/>
  <circle cx="260" cy="820" r="260" fill="${tertiary}" fill-opacity="0.12"/>
  <rect x="96" y="116" width="620" height="40" rx="20" fill="${tertiary}" fill-opacity="0.16"/>
  <rect x="96" y="186" width="880" height="164" rx="36" fill="rgba(255,255,255,0.08)"/>
  <text x="120" y="280" fill="#ffffff" font-size="84" font-weight="800" font-family="Segoe UI, Arial, sans-serif">${safeTitle}</text>
  <text x="120" y="410" fill="#ffffff" fill-opacity="0.9" font-size="40" font-weight="600" font-family="Segoe UI, Arial, sans-serif">${safeSubtitle}</text>
  <g transform="translate(96 560)">
    <rect width="560" height="220" rx="32" fill="rgba(255,255,255,0.10)"/>
    <rect x="38" y="44" width="180" height="18" rx="9" fill="${tertiary}" fill-opacity="0.35"/>
    <rect x="38" y="92" width="460" height="20" rx="10" fill="#ffffff" fill-opacity="0.82"/>
    <rect x="38" y="132" width="380" height="20" rx="10" fill="#ffffff" fill-opacity="0.62"/>
    <rect x="38" y="176" width="210" height="18" rx="9" fill="${highlight}" fill-opacity="0.75"/>
  </g>
  <g transform="translate(1020 508)">
    <rect width="360" height="272" rx="36" fill="rgba(255,255,255,0.12)"/>
    <circle cx="180" cy="84" r="34" fill="${tertiary}" fill-opacity="0.28"/>
    <rect x="54" y="148" width="252" height="18" rx="9" fill="#ffffff" fill-opacity="0.78"/>
    <rect x="54" y="188" width="198" height="18" rx="9" fill="#ffffff" fill-opacity="0.58"/>
  </g>
</svg>`;
}

function createAssetSlug(parts: string[]): string {
  return parts.map((part) => slugify(part)).filter(Boolean).join("-");
}

interface RouteAssignment {
  routePath: string;
  routeLeaf: string;
  keywordHint: string;
}

async function writePageVisual(
  hugo: ReturnType<typeof createHugoManager>,
  parts: string[],
  title: string,
  subtitle: string,
  design: DesignSystemContext,
  pageType: "city_hub" | "service_subpage",
  city: string,
  pestType?: string
): Promise<string> {
  const assetLabel = parts.join("/");
  console.log(`[Agent 3][Visual][${assetLabel}] Resolving page visual...`);
  if (!hasStockImageProviderKeys()) {
    const fallbackPath = `images/generated/${createAssetSlug(parts)}.svg`;
    hugo.writeStaticFile(
      fallbackPath,
      createDeterministicImageSvg(
        title,
        subtitle,
        design.primary,
        design.secondary,
        design.tertiary,
        design.highlight
      )
    );
    console.log(`[Agent 3][Visual][${assetLabel}] No image API keys configured; using generated SVG fallback`);
    return `/${fallbackPath}`;
  }

  const stockAsset = await fetchStockImageAsset({
    pageType,
    city,
    pestType,
  });
  if (stockAsset) {
    const assetPath = `images/sourced/${createAssetSlug(parts)}.${stockAsset.ext}`;
    hugo.writeStaticFile(assetPath, stockAsset.bytes);
    console.log(`[Agent 3][Visual][${assetLabel}] Using sourced stock image (${stockAsset.ext})`);
    return `/${assetPath}`;
  }

  const fallbackPath = `images/generated/${createAssetSlug(parts)}.svg`;
  hugo.writeStaticFile(
    fallbackPath,
    createDeterministicImageSvg(
      title,
      subtitle,
      design.primary,
      design.secondary,
      design.tertiary,
      design.highlight
    )
  );
  console.log(`[Agent 3][Visual][${assetLabel}] Using generated SVG fallback`);
  return `/${fallbackPath}`;
}

function normalizeRoutePath(candidate: string, citySlug: string): string {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return "";
  }

  const bare = trimmed.replace(/^\/+|\/+$/g, "");
  if (!bare) {
    return citySlug;
  }

  if (bare === citySlug || bare.startsWith(`${citySlug}/`)) {
    return bare;
  }

  return `${citySlug}/${bare}`;
}

function looksLikeRoute(candidate: string, citySlug: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.includes("/")) {
    return true;
  }

  const bare = trimmed.replace(/^\/+|\/+$/g, "");
  return bare === citySlug || bare.startsWith(`${citySlug}-`);
}

function deriveRouteAssignments(
  value: unknown,
  citySlug: string
): RouteAssignment[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const assignments: RouteAssignment[] = [];
  const seen = new Set<string>();

  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    const valueString = typeof rawValue === "string"
      ? rawValue.trim()
      : "";
    const routeCandidate = looksLikeRoute(key, citySlug)
      ? key
      : looksLikeRoute(valueString, citySlug)
        ? valueString
        : "";
    const routePath = normalizeRoutePath(routeCandidate || key, citySlug);
    const routeLeaf = routePath === citySlug
      ? ""
      : routePath.slice(citySlug.length + 1);
    const keywordHint = routeCandidate === key
      ? valueString
      : key;
    const fingerprint = `${routePath}|${keywordHint.toLowerCase()}`;

    if (seen.has(fingerprint)) {
      continue;
    }

    seen.add(fingerprint);
    assignments.push({ routePath, routeLeaf, keywordHint });
  }

  return assignments;
}

function findRouteAssignment(
  cluster: any,
  assignments: RouteAssignment[]
): RouteAssignment | null {
  const primaryKeyword = String(cluster?.primary_keyword ?? "").trim().toLowerCase();
  const clusterName = String(cluster?.cluster_name ?? "").trim().toLowerCase();
  const clusterSlug = slugify(String(cluster?.cluster_name ?? cluster?.primary_keyword ?? ""));

  for (const assignment of assignments) {
    const keywordHint = assignment.keywordHint.trim().toLowerCase();
    const routeLeaf = assignment.routeLeaf.trim().toLowerCase();

    if (!assignment.routeLeaf) {
      continue;
    }

    if (keywordHint && (keywordHint === primaryKeyword || keywordHint === clusterName)) {
      return assignment;
    }

    if (routeLeaf && (routeLeaf === clusterSlug || routeLeaf.endsWith(`/${clusterSlug}`))) {
      return assignment;
    }
  }

  return null;
}

function resolveServiceSlug(
  cluster: any,
  assignments: RouteAssignment[]
): string {
  const assignment = findRouteAssignment(cluster, assignments);
  if (assignment) {
    return assignment.routeLeaf;
  }

  return slugify(String(cluster?.cluster_name ?? cluster?.primary_keyword ?? "service"));
}

function normalizeDesignSpec(row: Record<string, unknown>, niche: string): DesignSpec {
  const fallbackLayout: DesignSpec["layout"] = {
    primary_archetype: "local-authority",
    supported_archetypes: [
      {
        name: "local-authority",
        intent: "trust-first local research",
        cvr_range: "5-10%",
        best_for: ["city pages", "organic traffic"],
        section_order: ["header", "hero", "trust", "services", "faq", "cta"],
      },
    ],
    section_order: ["header", "hero", "trust", "services", "faq", "cta"],
    section_rules: [
      {
        section: "hero",
        purpose: "Drive immediate calls",
        required_elements: ["headline", "phone", "call button"],
        repeats_primary_cta: true,
      },
      {
        section: "trust",
        purpose: "Reduce skepticism",
        required_elements: ["review signal", "license", "insured"],
        repeats_primary_cta: false,
      },
      {
        section: "cta",
        purpose: "Close late-stage visitors",
        required_elements: ["call button", "microcopy"],
        repeats_primary_cta: true,
      },
    ],
    conversion_strategy: {
      primary_cta_type: "call",
      no_forms: true,
      cta_labels: ["Call Now", "Call For Help Today", "Call For A Free Inspection"],
      cta_placements: ["header", "hero", "mid-page", "sticky-footer", "final-cta"],
      sticky_mobile_call_cta: true,
      phone_mentions_min: 4,
    },
    trust_strategy: {
      above_fold: ["rating", "licensed and insured"],
      mid_page: ["testimonials", "guarantee"],
      near_cta: ["call recording note"],
      footer: ["disclaimer", "privacy links"],
    },
    content_rules: {
      city_hub_words: { min: 400, max: 700 },
      service_page_words: { min: 500, max: 900 },
      reading_grade_target: "5th-7th grade",
      sentence_style: "short, direct, concrete",
    },
  };
  const fallbackComponents: DesignSpec["components"] = [
    {
      name: "sticky-call-bar",
      type: "mobile-footer",
      purpose: "Persistent click-to-call",
      mobile_behavior: "fixed bottom",
      required: true,
    },
  ];
  const fallbackColors: DesignSpec["colors"] = {
    primary: "#FF6B00",
    secondary: "#14213D",
    background: "#FFFFFF",
    surface: "#F4EFE6",
    cta_primary: "#FF6B00",
    cta_primary_hover: "#E85D04",
    urgency: "#C1121F",
    text: "#14213D",
    text_muted: "#5C677D",
    trust: "#2A9D8F",
  };
  const fallbackTypography: DesignSpec["typography"] = {
    heading: "\"Avenir Next\", \"Segoe UI\", sans-serif",
    body: "\"Trebuchet MS\", \"Segoe UI\", sans-serif",
    body_size_desktop: "18px",
    body_size_mobile: "16px",
    cta_size: "18px",
  };
  const fallbackBreakpoints: DesignSpec["responsive_breakpoints"] = {
    mobile: 0,
    phablet: 480,
    tablet: 768,
    laptop: 1024,
    desktop: 1280,
  };

  return {
    niche,
    archetype: typeof row.archetype === "string" ? row.archetype : "local-service",
    layout: asObject<DesignSpec["layout"]>(row.layout, fallbackLayout),
    components: asObject<DesignSpec["components"]>(row.components, fallbackComponents),
    colors: asObject<DesignSpec["colors"]>(row.colors, fallbackColors),
    typography: asObject<DesignSpec["typography"]>(row.typography, fallbackTypography),
    responsive_breakpoints: asObject<DesignSpec["responsive_breakpoints"]>(row.responsive_breakpoints, fallbackBreakpoints),
  };
}

function normalizeCopyFramework(row: Record<string, unknown>, niche: string): CopyFramework {
  return {
    niche,
    headlines: asStringArray(row.headlines),
    ctas: asStringArray(row.ctas),
    cta_microcopy: asStringArray(row.cta_microcopy),
    trust_signals: asStringArray(row.trust_signals),
    guarantees: asStringArray(row.guarantees),
    reading_level: asObject<{
      target_grade_min: number;
      target_grade_max: number;
      tone: string;
      banned_phrases: string[];
    }>(row.reading_level, {
      target_grade_min: 5,
      target_grade_max: 7,
      tone: "direct and reassuring",
      banned_phrases: [],
    }),
    vertical_angles: asObject<{
      general_pest: string;
      termites: string;
      bed_bugs: string;
      wildlife_rodents: string;
      ants?: string;
      spiders?: string;
      cockroaches?: string;
      mosquitoes?: string;
    }>(row.vertical_angles, {
      general_pest: "Fast relief and safer living spaces.",
      termites: "Protect your home from expensive structural damage.",
      bed_bugs: "Stop bites and sleep disruption quickly.",
      wildlife_rodents: "Remove health risks and prevent property damage.",
    }),
    faq_templates: asFaqArray(row.faq_templates),
    pas_scripts: asObject<Array<{ problem: string; agitate: string; solve: string }>>(row.pas_scripts, []),
  };
}

function resolveSchemaTemplate(
  schemaTemplates: Record<string, unknown>,
  pageType: "city_hub" | "service_subpage",
  city: string,
  state: string,
  title: string,
  description: string,
  phone?: string
): Record<string, unknown> {
  const replacements: Record<string, string> = {
    city,
    state,
    title,
    name: title,
    description,
    meta_description: description,
    phone: phone ?? "",
    telephone: phone ?? "",
  };

  const resolveTemplateValue = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value
        .replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => replacements[key] ?? "")
        .replace(/\[([A-Z0-9_ -]+)\]/g, "");
    }

    if (Array.isArray(value)) {
      return value.map((item) => resolveTemplateValue(item));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
          key,
          resolveTemplateValue(nestedValue),
        ])
      );
    }

    return value;
  };

  const normalizeSchemaRecord = (input: Record<string, unknown>): Record<string, unknown> => {
    const normalized = { ...input };
    const localBusinessType = "LocalBusiness";
    const pestControlCategory = "https://www.productontology.org/id/Pest_control";

    if (normalized["@type"] === "PestControlService") {
      normalized["@type"] = pageType === "city_hub" ? localBusinessType : "Service";
    }

    if (pageType === "city_hub") {
      if (normalized["@type"] !== "Service") {
        normalized["@type"] = localBusinessType;
      }
      if (typeof normalized.additionalType !== "string") {
        normalized.additionalType = pestControlCategory;
      }
    } else {
      normalized["@type"] = "Service";

      const providerValue = normalized.provider;
      const provider =
        providerValue && typeof providerValue === "object" && !Array.isArray(providerValue)
          ? { ...(providerValue as Record<string, unknown>) }
          : {};

      if (provider["@type"] === "PestControlService" || typeof provider["@type"] !== "string") {
        provider["@type"] = localBusinessType;
      }
      if (typeof provider.additionalType !== "string") {
        provider.additionalType = pestControlCategory;
      }
      provider.areaServed = {
        "@type": "City",
        name: city,
        containedInPlace: {
          "@type": "State",
          name: state,
        },
      };
      normalized.provider = provider;
    }

    return normalized;
  };

  const candidates =
    pageType === "city_hub"
      ? ["city_hub", "cityHub", "local_business", "localBusiness", "hub"]
      : ["service_subpage", "serviceSubpage", "service", "pest_service", "pestService"];

  for (const key of candidates) {
    const template = schemaTemplates[key];
    if (template && typeof template === "object" && !Array.isArray(template)) {
      return normalizeSchemaRecord({
        ...(resolveTemplateValue(template) as Record<string, unknown>),
        name: title,
        description,
        areaServed: {
          "@type": "City",
          name: city,
          containedInPlace: {
            "@type": "State",
            name: state,
          },
        },
      });
    }
  }

  return normalizeSchemaRecord({
    "@context": "https://schema.org",
    "@type": pageType === "city_hub" ? "LocalBusiness" : "Service",
    additionalType: "https://www.productontology.org/id/Pest_control",
    name: title,
    description,
    areaServed: {
      "@type": "City",
      name: city,
      containedInPlace: {
        "@type": "State",
        name: state,
      },
    },
  });
}

function summarizeSeasonalResearch(
  seasonalCalendar: DesignSystemContext["seasonalCalendar"],
  keyword: string,
  pestType?: string,
  region?: string
): string {
  const target = `${keyword} ${pestType ?? ""}`.toLowerCase();
  const matches = seasonalCalendar.filter((month) => {
    const haystack = [
      month.name,
      month.messaging_priority,
      ...month.primary_pests,
      ...month.content_topics,
      ...month.seasonal_keywords,
    ].join(" ").toLowerCase();

    return haystack.includes(target) ||
      month.primary_pests.some((pest) => target.includes(pest.toLowerCase())) ||
      month.seasonal_keywords.some((entry) => target.includes(entry.toLowerCase()));
  });

  const selection = (matches.length > 0 ? matches : seasonalCalendar).slice(0, 3);
  return selection
    .map((month) => {
      const pests = month.primary_pests.slice(0, 3).join(", ");
      let summary = `${month.name}: focus on ${pests || "priority pests"}; message = ${month.messaging_priority}`;
      // Append region-specific override notes if available
      if (region && (month as any).region_overrides) {
        const overrides = (month as any).region_overrides as Array<{ region: string; notes: string[] }>;
        const regionLower = region.toLowerCase();
        const matchingOverride = overrides.find((o) => o.region.toLowerCase().includes(regionLower) || regionLower.includes(o.region.toLowerCase()));
        if (matchingOverride && matchingOverride.notes.length > 0) {
          summary += `; regional notes for ${matchingOverride.region}: ${matchingOverride.notes.join(", ")}`;
        }
      }
      return summary;
    })
    .join(" | ");
}

function buildSeasonalFocus(
  seasonalCalendar: DesignSystemContext["seasonalCalendar"],
  keyword: string,
  summaryText: string,
  pestType?: string
): { message: string; season_name: string; seasonal_pests: string[]; icon: string } {
  const target = `${keyword} ${pestType ?? ""}`.toLowerCase();
  const matches = seasonalCalendar.filter((month) => {
    const haystack = [month.name, month.messaging_priority, ...month.primary_pests].join(" ").toLowerCase();
    return haystack.includes(target) || month.primary_pests.some((pest) => target.includes(pest.toLowerCase()));
  });
  const best = matches.length > 0 ? matches[0] : seasonalCalendar[0];
  const pests = best ? best.primary_pests.slice(0, 3) : [];
  const seasonName = best ? best.name : "Peak Season";
  const urgency = best ? best.messaging_priority : "Act now before infestations worsen";
  return {
    message: urgency,
    season_name: seasonName,
    seasonal_pests: pests,
    icon: "⚠️",
  };
}

async function applyDesignSystem(
  niche: string,
  db: DbClient,
  hugo: ReturnType<typeof createHugoManager>,
  llm: LlmClient
): Promise<DesignSystemContext> {
  const designResult = await db.query("SELECT * FROM design_specs WHERE niche = $1 LIMIT 1", [niche]);
  const copyResult = await db.query("SELECT * FROM copy_frameworks WHERE niche = $1 LIMIT 1", [niche]);
  const schemaResult = await db.query("SELECT * FROM schema_templates WHERE niche = $1 LIMIT 1", [niche]);
  const seasonalResult = await db.query("SELECT * FROM seasonal_calendars WHERE niche = $1 LIMIT 1", [niche]);

  if (
    designResult.rows.length === 0 ||
    copyResult.rows.length === 0 ||
    schemaResult.rows.length === 0 ||
    seasonalResult.rows.length === 0
  ) {
    throw new Error(`[Agent 3] Missing upstream research for ${niche}. Agent 3 requires design_specs, copy_frameworks, schema_templates, and seasonal_calendars from Agent 2 before build.`);
  }

  const designSpec = normalizeDesignSpec(designResult.rows[0] as Record<string, unknown>, niche);
  const copyFramework = normalizeCopyFramework(copyResult.rows[0] as Record<string, unknown>, niche);
  const schemaTemplates = asObject<Record<string, unknown>>(
    (schemaResult.rows[0] as Record<string, unknown>).jsonld_templates,
    {}
  );
  const seasonalCalendar = asSeasonalMonths(
    (seasonalResult.rows[0] as Record<string, unknown>).months
  );
  const layoutLabels = getLayoutLabels(designSpec.layout);
  const componentLabels = getComponentLabels(designSpec.components);
  const primary = selectColor(designSpec.colors, ["primary", "accent", "brand"], "#FF6B00");
  const secondary = selectColor(designSpec.colors, ["secondary", "ink", "dark"], "#14213D");
  const tertiary = selectColor(designSpec.colors, ["tertiary", "surface", "muted"], "#F4EFE6");
  const highlight = selectColor(designSpec.colors, ["highlight", "success"], "#2A9D8F");
  const headingFont = designSpec.typography.heading || "\"Avenir Next\", \"Segoe UI\", sans-serif";
  const bodyFont = designSpec.typography.body || "\"Trebuchet MS\", \"Segoe UI\", sans-serif";
  const heroHeadline =
    copyFramework.headlines[0] ||
    `${designSpec.archetype.replace(/[_-]+/g, " ")} ${layoutLabels[0] || "service"} flow`;
  const secondaryHeadline =
    copyFramework.headlines[1] ||
    `${componentLabels.slice(0, 2).join(" and ") || "High-converting service"} sections shaped by design research`;
  const primaryCta = copyFramework.ctas[0] || `Call for ${designSpec.archetype.replace(/[_-]+/g, " ")}`;
  const secondaryCta = copyFramework.ctas[1] || primaryCta;
  const ctaMicrocopy = copyFramework.cta_microcopy.slice(0, 2);
  const guarantees = copyFramework.guarantees.slice(0, 3);
  const readingLevel = copyFramework.reading_level;
  const verticalAngles = copyFramework.vertical_angles;
  const trustSignals = copyFramework.trust_signals.slice(0, 3);
  const trustMarkup = trustSignals
    .map((signal) => `<li>${escapeHtml(signal)}</li>`)
    .join("\n");
  const ctaMicrocopyText =
    ctaMicrocopy[0] ||
    "No obligation. Fast local routing. Same-day scheduling available.";
  const guaranteeLead =
    guarantees[0] ||
    "If pests come back between visits, call again and we will help you next.";
  const faqLead = copyFramework.faq_templates[0] ?? null;
  const faqQuestion = faqLead?.question || `How is the ${designSpec.archetype.replace(/[_-]+/g, " ")} process structured?`;
  const faqAnswer = faqLead?.answer_template || `The page layout follows ${layoutLabels.join(", ") || "the researched service sequence"} so visitors can move from urgency to proof to action without friction.`;

  const designSpecSummary = JSON.stringify({
    archetype: designSpec.archetype,
    layout: designSpec.layout,
    components: designSpec.components,
    colors: designSpec.colors,
    typography: designSpec.typography,
    responsive_breakpoints: designSpec.responsive_breakpoints,
  }, null, 2);
  const designFingerprint = computeCacheFingerprint(designSpecSummary);
  const templateCache = await db.query<{
    design_fingerprint: string;
    baseof: string;
    city_hub: string;
    service_subpage: string;
  }>(
    `SELECT design_fingerprint, baseof, city_hub, service_subpage
     FROM hugo_template_cache
     WHERE niche = $1
     LIMIT 1`,
    [normalizeNiche(niche)]
  );

  const generateHugoTemplatesFromLlm = async () => {
    const hugoPrompt = HUGO_TEMPLATE_PROMPT.replace("{design_spec}", designSpecSummary);
    const templateLogger = createVerboseProviderLogger("[Agent 3][Design system][Hugo templates]");
    let generatedTemplates;
    try {
      generatedTemplates = await llm.call({
        prompt: hugoPrompt,
        schema: HugoTemplateResponseSchema,
        model: "haiku",
        timeoutMs: AGENT3_TEMPLATE_TIMEOUT_MS,
        logLabel: "[Agent 3][Design system][Hugo templates]",
        onOutput: (chunk, stream) => templateLogger.onOutput(chunk, stream),
      });
    } finally {
      templateLogger.flush();
    }
    const generatedMarkup = [
      generatedTemplates.baseof,
      generatedTemplates.city_hub,
      generatedTemplates.service_subpage,
    ].join("\n");
    if (/<form\b/i.test(generatedMarkup)) {
      throw new Error("LLM template generation violated pay-per-call rules by emitting a user-facing form");
    }
    return {
      design_fingerprint: designFingerprint,
      ...generatedTemplates,
    };
  };

  let hugoTemplates = templateCache.rows[0];
  if (!hugoTemplates || hugoTemplates.design_fingerprint !== designFingerprint) {
    hugoTemplates = await generateHugoTemplatesFromLlm();
  } else {
    console.log("[Agent 3] Reusing cached Hugo templates");
  }

  let reviewedTemplateResult;
  try {
    reviewedTemplateResult = reviewGeneratedHugoTemplates({
      baseof: hugoTemplates.baseof,
      city_hub: hugoTemplates.city_hub,
      service_subpage: hugoTemplates.service_subpage,
    });
  } catch (err) {
    if (templateCache.rows[0] && hugoTemplates === templateCache.rows[0]) {
      console.warn(
        `[Agent 3][Design system][Template review] Cached template review failed, regenerating: ${err instanceof Error ? err.message : err}`
      );
      hugoTemplates = await generateHugoTemplatesFromLlm();
      reviewedTemplateResult = reviewGeneratedHugoTemplates({
        baseof: hugoTemplates.baseof,
        city_hub: hugoTemplates.city_hub,
        service_subpage: hugoTemplates.service_subpage,
      });
    } else {
      throw err;
    }
  }
  if (reviewedTemplateResult.repairsApplied.length > 0) {
    console.log(
      `[Agent 3][Design system][Template review] Applied repairs: ${reviewedTemplateResult.repairsApplied.join(", ")}`
    );
  } else {
    console.log("[Agent 3][Design system][Template review] No repairs needed");
  }

  await db.query(
    `INSERT INTO hugo_template_cache
     (niche, design_fingerprint, baseof, city_hub, service_subpage,
      cache_provider, cache_version, retrieval_method, confidence_score, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'llm', 'v2', 'generated', 0.75, now())
     ON CONFLICT (niche) DO UPDATE SET
       design_fingerprint = EXCLUDED.design_fingerprint,
       baseof = EXCLUDED.baseof,
       city_hub = EXCLUDED.city_hub,
       service_subpage = EXCLUDED.service_subpage,
       cache_provider = EXCLUDED.cache_provider,
       cache_version = EXCLUDED.cache_version,
       retrieval_method = EXCLUDED.retrieval_method,
       confidence_score = EXCLUDED.confidence_score,
       updated_at = now()`,
    [
      normalizeNiche(niche),
      designFingerprint,
      reviewedTemplateResult.templates.baseof,
      reviewedTemplateResult.templates.city_hub,
      reviewedTemplateResult.templates.service_subpage,
    ]
  );

  hugo.writeTemplate("_default/baseof.html", reviewedTemplateResult.templates.baseof);
  hugo.writeTemplate("_default/list.html", reviewedTemplateResult.templates.city_hub);
  hugo.writeTemplate("_default/single.html", reviewedTemplateResult.templates.service_subpage);
  console.log("[Agent 3] Wrote reviewed LLM-generated Hugo templates");

  hugo.writeStaticFile("css/generated-theme.css", `:root {
  --color-primary: ${primary};
  --color-primary-dark: ${primary};
  --color-secondary: ${secondary};
  --color-bg-alt: ${tertiary};
  --color-success: ${highlight};
  --color-cta-primary: ${designSpec.colors.cta_primary};
  --color-cta-primary-hover: ${designSpec.colors.cta_primary_hover};
  --color-urgency: ${designSpec.colors.urgency};
  --color-text: ${designSpec.colors.text};
  --color-text-muted: ${designSpec.colors.text_muted};
  --color-trust: ${designSpec.colors.trust};
  --color-background: ${designSpec.colors.background};
  --color-surface: ${designSpec.colors.surface};
  --color-border: #E8E8E8;
  --font-heading: ${headingFont};
  --font-body: ${bodyFont};
  --font-size-body-desktop: ${designSpec.typography.body_size_desktop || '16px'};
  --font-size-body-mobile: ${designSpec.typography.body_size_mobile || '14px'};
  --font-size-cta: ${designSpec.typography.cta_size || '18px'};
  --bp-mobile: ${designSpec.responsive_breakpoints.mobile}px;
  --bp-phablet: ${designSpec.responsive_breakpoints.phablet}px;
  --bp-tablet: ${designSpec.responsive_breakpoints.tablet}px;
  --bp-laptop: ${designSpec.responsive_breakpoints.laptop}px;
  --bp-desktop: ${designSpec.responsive_breakpoints.desktop}px;
}

.brand-shell {
  background:
    radial-gradient(circle at top right, rgba(255,255,255,0.65), transparent 32%),
    linear-gradient(180deg, #fffaf2 0%, #ffffff 24%, #f4efe6 100%);
}

.hero-split {
  padding: 56px 0;
  text-align: left;
}

.hero-grid {
  display: grid;
  gap: 24px;
  align-items: center;
}

.hero-copy {
  max-width: 40rem;
}

.eyebrow {
  display: inline-block;
  margin-bottom: 10px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: rgba(255,255,255,0.18);
  color: inherit;
}

.hero-support {
  margin-bottom: 24px;
  opacity: 0.85;
}

.cta-microcopy {
  margin: 0 0 12px;
  font-size: 0.95rem;
  opacity: 0.82;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.cta-secondary {
  background: rgba(255,255,255,0.14);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.28);
}

.cta-secondary:hover {
  background: rgba(255,255,255,0.2);
}

.hero-visual img,
.side-image img {
  width: 100%;
  height: 100%;
  min-height: 280px;
  object-fit: cover;
  border-radius: 24px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.18);
}

.trust-ribbon {
  padding: 22px 0;
  background: #fff;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.trust-points {
  display: grid;
  gap: 12px;
  list-style: none;
}

.trust-points li {
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(20,33,61,0.05);
  font-weight: 600;
}

.content-grid {
  display: grid;
  gap: 24px;
}

.content-main {
  min-width: 0;
}

.content-side {
  display: grid;
  gap: 18px;
}

.side-card {
  padding: 22px;
  border-radius: 20px;
  background: #fff;
  border: 1px solid rgba(20,33,61,0.08);
  box-shadow: 0 14px 30px rgba(20,33,61,0.06);
}

.side-card h2 {
  margin-top: 0;
  margin-bottom: 12px;
  font-size: 1.2rem;
}

.side-image {
  padding: 0;
  overflow: hidden;
}

.section-intro {
  max-width: 42rem;
  margin-bottom: 28px;
}

.services-grid-premium {
  position: relative;
  overflow: hidden;
}

.premium-card {
  border-radius: 20px;
  box-shadow: 0 18px 36px rgba(20,33,61,0.08);
}

.service-label {
  margin-bottom: 8px;
  color: var(--color-primary);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.spotlight-faq {
  background: transparent;
}

.faq-highlight {
  padding: 28px;
  border-radius: 24px;
  background: linear-gradient(135deg, ${secondary} 0%, ${primary} 100%);
  color: #fff;
}

.faq-highlight h2 {
  color: #fff;
  margin-top: 0;
}

.faq-guarantee {
  margin-top: 16px;
  font-weight: 700;
}

.cta-section-premium {
  background: linear-gradient(135deg, ${secondary} 0%, ${primary} 100%);
}

.mini-list {
  margin: 0;
  padding-left: 18px;
}

.mini-list li {
  margin-bottom: 10px;
}

@media (min-width: 900px) {
  .hero-grid {
    grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
  }

  .content-grid {
    grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
    align-items: start;
  }

  .trust-points {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 767px) {
  .hero-split {
    text-align: left;
  }

  .hero-actions {
    flex-direction: column;
  }

  .cta-secondary {
    min-height: 60px;
    line-height: 60px;
    width: 100%;
    text-align: center;
  }
}

@media (max-width: 767px) {
  body {
    font-size: var(--font-size-body-mobile, 14px);
  }
}

@media (min-width: 768px) {
  body {
    font-size: var(--font-size-body-desktop, 16px);
  }
}

/* Agent-2 Responsive Breakpoints */
@media (min-width: ${designSpec.responsive_breakpoints.phablet}px) {
  .container { padding: 0 20px; }
}

@media (min-width: ${designSpec.responsive_breakpoints.tablet}px) {
  .container { padding: 0 24px; }
  .hero-grid { grid-template-columns: 1fr 1fr; }
}

@media (min-width: ${designSpec.responsive_breakpoints.laptop}px) {
  .container { padding: 0 32px; }
  .content-grid { grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr); align-items: start; }
}

@media (min-width: ${designSpec.responsive_breakpoints.desktop}px) {
  .container { max-width: 1440px; }
}`);

  console.log("[Agent 3][Design system][Template review] Running Hugo template validation...");
  const templateValidation = await hugo.validateSite();
  if (!templateValidation.success) {
    throw new Error(`Generated Hugo templates failed validation: ${templateValidation.output}`);
  }
  console.log("[Agent 3][Design system][Template review] Hugo template validation passed");

  console.log(`[Agent 3] Applied generated design system for ${niche} (${designSpec.archetype})`);
  return {
    designSpec,
    copyFramework,
    schemaTemplates,
    seasonalCalendar,
    primary,
    secondary,
    tertiary,
    highlight,
    headingFont,
    bodyFont,
    heroHeadline,
    secondaryHeadline,
    primaryCta,
    secondaryCta,
    ctaMicrocopy,
    guarantees,
    readingLevel,
    verticalAngles,
    trustSignals,
    faqLead,
  };
}

function isServiceCluster(cluster: any, city: string, hubKeyword: string): boolean {
  const clusterName = String(cluster?.cluster_name ?? "").trim();
  const primaryKeyword = String(cluster?.primary_keyword ?? "").trim();
  const normalizedClusterName = clusterName.toLowerCase();
  const normalizedPrimaryKeyword = primaryKeyword.toLowerCase();
  const normalizedHubKeyword = hubKeyword.trim().toLowerCase();
  const normalizedCity = city.trim().toLowerCase();

  if (cluster?.intent === "navigational") {
    return false;
  }

  if (!clusterName || !primaryKeyword) {
    return false;
  }

  if (normalizedPrimaryKeyword === normalizedHubKeyword) {
    return false;
  }

  if (normalizedClusterName === normalizedHubKeyword) {
    return false;
  }

  if (
    /(?:^|\b)(city hub|hub page|homepage|home page|main page)(?:\b|$)/i.test(clusterName)
  ) {
    return false;
  }

  if (normalizedClusterName === normalizedCity) {
    return false;
  }

  return true;
}

function getContentFilePath(hugoSitePath: string, relativePath: string): string {
  return path.join(hugoSitePath, "content", relativePath);
}

function contentFileHasPlaceholders(contentFilePath: string): boolean {
  if (!fs.existsSync(contentFilePath)) {
    return false;
  }

  const fileContent = fs.readFileSync(contentFilePath, "utf-8");
  return findPlaceholderTokens([fileContent]).length > 0;
}

async function shouldSkipCheckpointedPage(
  db: DbClient,
  checkpoints: Awaited<ReturnType<typeof createCheckpointTracker>>,
  checkpointKey: string,
  contentFilePath: string,
  contentSlug: string
): Promise<boolean> {
  const fileExists = fs.existsSync(contentFilePath);
  if (checkpoints.has(checkpointKey)) {
    if (!fileExists) {
      return false;
    }

    if (contentFileHasPlaceholders(contentFilePath)) {
      console.warn(
        `[Agent 3] Checkpointed output contains placeholder tokens, regenerating: ${contentSlug}`
      );
      return false;
    }

    return true;
  }

  if (!fileExists) {
    return false;
  }

  if (contentFileHasPlaceholders(contentFilePath)) {
    console.warn(
      `[Agent 3] Existing output contains placeholder tokens, regenerating: ${contentSlug}`
    );
    return false;
  }

  const existingItem = await db.query<{ slug: string }>(
    "SELECT slug FROM content_items WHERE slug = $1 LIMIT 1",
    [contentSlug]
  );
  if (existingItem.rows.length === 0) {
    return false;
  }

  await checkpoints.mark(checkpointKey, {
    slug: contentSlug,
    source: "existing_output",
  });
  return true;
}

function isAllowedServiceCluster(
  cluster: any,
  offerProfile?: OfferProfile | null,
  verticalProfile?: VerticalProfile | null
): boolean {
  if (!offerProfile && !verticalProfile) {
    return true;
  }

  const value = `${String(cluster?.cluster_name ?? "")} ${String(cluster?.primary_keyword ?? "")}`;
  const strategy = resolveVerticalStrategy(verticalProfile?.vertical_key ?? offerProfile?.vertical);
  return strategy.isServiceAllowed(value, {
    offerProfile,
    verticalProfile,
  });
}

function applyOfferContentRules(
  content: z.infer<typeof ContentResponseSchema>,
  offerProfile?: OfferProfile | null
): z.infer<typeof ContentResponseSchema> {
  if (!offerProfile) {
    return content;
  }

  const scrubText = (input: string): string => {
    let output = input;
    for (const service of offerProfile.constraints.disallowed_services) {
      if (!service) continue;
      const token = service
        .split("-")
        .filter(Boolean)
        .join("[\\s-]+");
      if (!token) continue;
      output = output.replace(
        new RegExp(`\\b${token}\\b`, "gi"),
        "common household pests"
      );
    }
    for (const phrase of offerProfile.constraints.banned_phrases) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      output = output.replace(new RegExp(escaped, "gi"), "Call now");
    }
    return output;
  };

  let normalizedContent = scrubText(content.content);

  const disclaimer = offerProfile.constraints.required_disclaimer.trim();
  if (disclaimer && !normalizedContent.includes(disclaimer)) {
    normalizedContent = `${normalizedContent}\n\n---\n\n${disclaimer}`;
  }

  return {
    ...content,
    title: scrubText(content.title),
    meta_description: scrubText(content.meta_description),
    content: normalizedContent,
    headings: content.headings?.map((heading) => scrubText(heading)),
    faq: content.faq?.map((item) => ({
      question: scrubText(item.question),
      answer: scrubText(item.answer),
    })),
  };
}

export async function runAgent3(
  config: Agent3Config,
  llm: LlmClient,
  db: DbClient
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const strategy = resolveVerticalStrategy(
    cfg.verticalProfile?.vertical_key ?? cfg.offerProfile?.vertical
  );
  const strategyContext = {
    offerProfile: cfg.offerProfile,
    verticalProfile: cfg.verticalProfile,
  };
  const checkpointScope = buildCheckpointScope([
    normalizeNiche(cfg.niche),
    cfg.offerProfile?.constraints ?? null,
    [...(cfg.targetCities ?? [])].map((city) => city.trim().toLowerCase()).sort(),
    cfg.phone,
  ]);
  const checkpoints = await createCheckpointTracker(db, "agent-3", checkpointScope);
  const buildRecord = await createSiteBuildRecord(db, cfg);
  const hugo = createHugoManager(cfg.hugoSitePath);
  let cityRows: any[] = [];

  try {
    hugo.ensureProject();
    const designSystem = await applyDesignSystem(cfg.niche, db, hugo, llm);

    console.log(`[Agent 3] Starting site build for ${cfg.niche}`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Starting", detail: cfg.niche, timestamp: Date.now() });
    await updateSiteBuildRecord(db, buildRecord.id, "GENERATING_CONTENT");

    const citiesResult = await db.query(
      "SELECT city, state, url_mapping, keyword_cluster_ids FROM city_keyword_map WHERE niche = $1",
      [cfg.niche]
    );
    const requestedCities = new Set(
      (cfg.targetCities ?? []).map((city) => city.trim().toLowerCase()).filter(Boolean)
    );
    cityRows = requestedCities.size > 0
      ? citiesResult.rows.filter((row: any) =>
          requestedCities.has(String(row.city ?? "").trim().toLowerCase())
        )
      : citiesResult.rows;

    if (cityRows.length === 0) {
      console.log("[Agent 3] No cities found in keyword map. Run Agent 1 first.");
      await updateSiteBuildRecord(db, buildRecord.id, "FAILED", {
        error: "No cities found in city_keyword_map for the requested build.",
        completed: true,
      });
      return;
    }

    let newCitySlotsRemaining = Number.POSITIVE_INFINITY;
    if (cfg.enforceNewCityCap) {
      const recentDeploysResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pages
         WHERE niche = $1
           AND created_at >= now() - interval '7 days'`,
        [cfg.niche]
      );
      newCitySlotsRemaining = Math.max(
        0,
        Number(cfg.maxNewCitiesPerWeek ?? 3) - Number(recentDeploysResult.rows[0]?.count ?? "0")
      );
      if (newCitySlotsRemaining === 0) {
        console.warn("[Agent 3] Weekly new-city deployment cap reached. Skipping new city launches.");
      }
    }

    if (
      cfg.indexationKillSwitchEnabled &&
      cfg.searchConsoleIntegrationEnabled &&
      !cfg.ignoreIndexationKillSwitch
    ) {
      const indexationResult = await db.query<{ eligible_pages: string; indexed_pages: string }>(
        `SELECT
           COUNT(*)::text AS eligible_pages,
           COUNT(*) FILTER (
             WHERE p.indexation_status = 'indexed'
                OR EXISTS (
                  SELECT 1
                  FROM ranking_snapshots rs
                  WHERE rs.page_id = p.id
                )
           )::text AS indexed_pages
         FROM pages p
         WHERE p.niche = $1
           AND p.created_at <= now() - (($2::text || ' days')::interval)
           AND p.created_at >= now() - (($3::text || ' days')::interval)`,
        [
          cfg.niche,
          String(cfg.indexationMinPageAgeDays ?? 21),
          String(cfg.indexationLookbackDays ?? 30),
        ]
      );
      const eligiblePages = Number(indexationResult.rows[0]?.eligible_pages ?? "0");
      const indexedPages = Number(indexationResult.rows[0]?.indexed_pages ?? "0");
      const indexationRatio = eligiblePages > 0 ? indexedPages / eligiblePages : 1;

      if (eligiblePages > 0 && indexationRatio < Number(cfg.minIndexationRatio ?? 0.5)) {
        console.warn(
          `[Agent 3] Indexation kill switch active. Ratio ${indexationRatio.toFixed(2)} is below ${(cfg.minIndexationRatio ?? 0.5).toFixed(2)}.`
        );
        newCitySlotsRemaining = 0;
      }
    }

    for (const cityRow of cityRows) {
      const processCity = async () => {
        const { city, state } = cityRow;
        const citySlug = slugify(city);
        const existingPageResult = await db.query<{ id: string }>(
          "SELECT id FROM pages WHERE slug = $1 AND niche = $2 LIMIT 1",
          [citySlug, cfg.niche]
        );
        const isExistingCity = existingPageResult.rows.length > 0;
        if (!isExistingCity) {
          if (cfg.enforceNewCityCap && newCitySlotsRemaining <= 0) {
            console.warn(`[Agent 3] Skipping ${city}, ${state}; weekly new-city cap reached.`);
            return;
          }
          if (cfg.enforceNewCityCap) {
            newCitySlotsRemaining -= 1;
          }
        }

        const routeAssignments = deriveRouteAssignments(cityRow.url_mapping, citySlug);
        const approvedRoutes = routeAssignments.map((assignment) => assignment.routePath);
        console.log(`[Agent 3] Building pages for ${city}, ${state}`);
        eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Building city", detail: `${city}, ${state}`, timestamp: Date.now() });

        const clusterIds = Array.isArray(cityRow.keyword_cluster_ids)
          ? cityRow.keyword_cluster_ids
          : [];
        const clustersResult = await db.query(
          "SELECT * FROM keyword_clusters WHERE id = ANY($1::uuid[])",
          [clusterIds]
        );
        const clusterOrder = new Map(clusterIds.map((id: string, index: number) => [id, index]));
        const orderedClusters = [...clustersResult.rows].sort(
          (a: any, b: any) => {
            const aIndex = clusterOrder.has(String(a.id))
              ? Number(clusterOrder.get(String(a.id)))
              : Number.MAX_SAFE_INTEGER;
            const bIndex = clusterOrder.has(String(b.id))
              ? Number(clusterOrder.get(String(b.id)))
              : Number.MAX_SAFE_INTEGER;
            return aIndex - bIndex;
          }
        );
        console.log(`[Agent 3] Loaded ${orderedClusters.length} keyword clusters for ${city} from Agent 1 map`);

        const hubKeyword = orderedClusters.find(
          (c: any) => c.intent === "transactional"
        )?.primary_keyword ?? `${city} ${cfg.niche}`;
        const hubSeasonalSummaryText = summarizeSeasonalResearch(
          designSystem.seasonalCalendar,
          hubKeyword,
          undefined,
          state
        );
        const hubSeasonalSummary = buildSeasonalFocus(designSystem.seasonalCalendar, hubKeyword, hubSeasonalSummaryText);

        // Compute service clusters early so hub page can reference them
        const serviceClusterTypes = orderedClusters.filter(
          (c: any) =>
            isServiceCluster(c, city, hubKeyword) &&
            findRouteAssignment(c, routeAssignments) &&
            isAllowedServiceCluster(c, cfg.offerProfile, cfg.verticalProfile)
        );

        const hubCheckpointKey = `hub:${citySlug}`;
        const hubContentPath = getContentFilePath(cfg.hugoSitePath, `${citySlug}/_index.md`);
        const shouldSkipHub = await shouldSkipCheckpointedPage(
          db,
          checkpoints,
          hubCheckpointKey,
          hubContentPath,
          citySlug
        );
        // Determine license status for this state (accessible to both hub and subpage scopes)
        const hasLicense = false; // Configurable: set true when business obtains a pest control license
        const stateRequiresLicense = LICENSE_REQUIRED_STATES.has(state);
        if (stateRequiresLicense && !hasLicense) {
          console.log(`[Agent 3] Note: ${state} requires pest control license. Site will not display license claims for ${city}.`);
        }

        // CTA text shared between hub and subpage frontmatter
        const heroCta = designSystem.primaryCta || "Call a Local Pro Now";
        const midCtaButton = designSystem.secondaryCta || "Connect With a Pro in Your Area";
        const stickyCta = designSystem.copyFramework.ctas[2] || "Call Now";

        if (shouldSkipHub) {
          console.log(`[Agent 3] Reusing checkpointed hub page for ${city}`);
        } else {
          console.log(`[Agent 3] Generating hub page for ${city}...`);
          eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Hub page", detail: city, timestamp: Date.now() });
          const hubPrompt = strategy.getCityHubPrompt(
            {
              city,
              state,
              keyword: hubKeyword,
              phone: cfg.phone!,
              agent1Summary: `- Approved hub keyword: ${hubKeyword}
- Approved route keys: ${approvedRoutes.join(", ") || "none"}
- Approved cluster count: ${orderedClusters.length}`,
              agent2Summary: [
                "- Archetype: " + designSystem.designSpec.archetype,
                "- Layout sequence: " + Object.keys(designSystem.designSpec.layout).join(", "),
                "- CTA variants: " + designSystem.copyFramework.ctas.join(" | "),
                "- Trust signals: " + designSystem.copyFramework.trust_signals.join(" | "),
                "- Guarantees to weave in: " + (designSystem.guarantees.join(" | ") || "satisfaction guaranteed"),
                "- CTA microcopy: " + (designSystem.ctaMicrocopy[0] || "No obligation, fast local routing"),
                "- Reading level: Write at " + designSystem.readingLevel.target_grade_min + "th-" + designSystem.readingLevel.target_grade_max + "th grade level. Tone: " + designSystem.readingLevel.tone + ". Short sentences, direct language.",
                "- Emotional angles: General pest = " + designSystem.verticalAngles.general_pest + "; Termites = " + designSystem.verticalAngles.termites + "; Bed bugs = " + designSystem.verticalAngles.bed_bugs + "; Wildlife/rodents = " + designSystem.verticalAngles.wildlife_rodents,
                "- PAS scripts: " + (designSystem.copyFramework.pas_scripts.map((s) => "Problem: " + s.problem + " | Agitate: " + s.agitate + " | Solve: " + s.solve).join("; ") || "none"),
                "- Conversion strategy: Phone mentions minimum " + (designSystem.designSpec.layout.conversion_strategy?.phone_mentions_min ?? 4) + ", no forms allowed",
                "- Trust placement hierarchy: Above fold = " + (designSystem.designSpec.layout.trust_strategy?.above_fold ?? []).join(", ") + "; Mid-page = " + (designSystem.designSpec.layout.trust_strategy?.mid_page ?? []).join(", ") + "; Near CTA = " + (designSystem.designSpec.layout.trust_strategy?.near_cta ?? []).join(", "),
              ].join("\n"),
              seasonalGuidance: hubSeasonalSummaryText,
            },
            strategyContext
          );
          const hubReplacements = {
            city,
            state,
            phone: cfg.phone ?? "",
            telephone: cfg.phone ?? "",
            keyword: hubKeyword,
            title: city,
            name: city,
          };
          const hubLogLabel = `[Agent 3][Hub page][${city}]`;
          const hubLogger = createVerboseProviderLogger(hubLogLabel);
          let rawHubContent;
          try {
            rawHubContent = await llm.call({
              prompt: hubPrompt,
              schema: ContentResponseSchema,
              model: "sonnet",
              timeoutMs: AGENT3_CONTENT_TIMEOUT_MS,
              logLabel: hubLogLabel,
              onOutput: (chunk, stream) => hubLogger.onOutput(chunk, stream),
            });
          } finally {
            hubLogger.flush();
          }
          const hubContent = applyOfferContentRules(
            resolveGeneratedContentPlaceholders(rawHubContent, hubReplacements),
            cfg.offerProfile
          );
          const hubSchemaTemplate = resolveSchemaTemplate(
            designSystem.schemaTemplates,
            "city_hub",
            city,
            state,
            hubContent.title,
            hubContent.meta_description,
            cfg.phone
          );
          console.log(`[Agent 3] Hub page title: ${hubContent.title}`);
          console.log(
            `[Agent 3] Hub headings: ${(hubContent.headings ?? []).slice(0, 4).join(" | ") || "none"}`
          );

          let finalHubContent = hubContent;
          const minHubWords = designSystem.designSpec.layout?.content_rules?.city_hub_words?.min ?? cfg.minWordCountHub!;
          console.log(`[Agent 3] Hub word count minimum: ${minHubWords} (source: ${designSystem.designSpec.layout?.content_rules?.city_hub_words?.min ? "agent-2 content_rules" : "config"})`);
          const hubPhoneMin = designSystem.designSpec.layout?.conversion_strategy?.phone_mentions_min ?? 3;
          const hubSectionRules = (designSystem.designSpec.layout?.section_rules ?? []) as SectionRule[];
          const hubHeroImageAlt = `${hubKeyword} pest control in ${city}`;
          let hubQuality = runQualityGate(
            finalHubContent.content,
            city,
            minHubWords,
            [
              finalHubContent.title,
              finalHubContent.meta_description,
              JSON.stringify(hubSchemaTemplate),
            ],
            hubPhoneMin,
            designSystem.readingLevel,
            hubSectionRules,
            {
              title: finalHubContent.title,
              description: finalHubContent.meta_description,
              heroImageAlt: hubHeroImageAlt,
              targetKeyword: hubKeyword,
            }
          );
          if (hubQuality.warnings.length > 0) {
            console.warn(`[Agent 3] Hub page QA warnings for ${city}: ${hubQuality.warnings.join("; ")}`);
          }
          if (!hubQuality.passed) {
            const canAutoRepair = canAutoRepairQaFailures(hubQuality.failures);
            if (!canAutoRepair) {
              throw new Error(`Hub page QA failed for ${city}: ${hubQuality.failures.join(", ")}`);
            }

            console.warn(
              `[Agent 3] Hub page QA found repairable issues for ${city}: ${hubQuality.failures.join(", ")}; attempting repair`
            );
            const repaired = await repairContentForQa(llm, {
              prompt: hubPrompt,
              content: finalHubContent,
              city,
              minWordCount: minHubWords,
              supplementalTexts: [JSON.stringify(hubSchemaTemplate)],
              failures: hubQuality.failures,
              bannedPhrasesFound: hubQuality.metrics.bannedPhrasesFound,
              logLabel: `[Agent 3][Hub page repair][${city}]`,
              replacements: hubReplacements,
            });
            finalHubContent = repaired.content;
            hubQuality = repaired.quality;
            if (!hubQuality.passed) {
              throw new Error(
                `Hub page QA failed after repair for ${city}: ${hubQuality.failures.join(", ")}`
              );
            }
            console.log(`[Agent 3] Hub page repair passed QA for ${city}`);
          }

          const hubSlug = `${citySlug}/_index.md`;
          const hubHeroImage = await writePageVisual(
            hugo,
            [city, "hub", "hero"],
            city,
            hubKeyword,
            designSystem,
            "city_hub",
            city
          );
          const hubFeatureImage = await writePageVisual(
            hugo,
            [city, "hub", "feature"],
            `${city} Coverage`,
            designSystem.heroHeadline,
            designSystem,
            "city_hub",
            city
          );
          // Build services grid from service clusters for the hub page
          const hubServices = serviceClusterTypes.slice(0, 8).map((cluster: any) => {
            const pestName = serviceSlugToLabel(cluster.cluster_name);
            const svcSlug = resolveServiceSlug(cluster, routeAssignments);
            return {
              icon: getPestIcon(cluster.cluster_name),
              name: pestName,
              description: getPestDescription(pestName),
              link: `/${citySlug}/${svcSlug}/`,
            };
          });

          // Build nearby cities list from other cities in this build
          const nearbyCities = cityRows
            .filter((row: any) => String(row.city ?? "").trim().toLowerCase() !== city.trim().toLowerCase())
            .map((row: any) => ({
              name: String(row.city ?? "").trim(),
              slug: slugify(String(row.city ?? "")),
            }))
            .slice(0, 12);

          // Resolve disclaimer text from offer profile or use generic referral disclaimer
          const disclaimerText =
            cfg.offerProfile?.constraints?.required_disclaimer?.trim() ||
            `${cfg.offerProfile?.constraints?.required_disclaimer?.trim() ? "" : ""}This website is a referral service connecting consumers with local pest control professionals. We are not a pest control company. By calling the number on this page, your call may be routed to a third-party service provider. Calls may be recorded for quality assurance. The specific services, pricing, scheduling, and service guarantees are determined by the independent provider dispatched to your location.`.trim();

          // Build FAQ data from LLM-generated content and copy framework
          const hubFaqs = (finalHubContent.faq ?? []).length > 0
            ? finalHubContent.faq!
            : designSystem.copyFramework.faq_templates.slice(0, 6).map((tpl) => ({
                question: tpl.question.replace(/\{city\}/g, city).replace(/\{service\}/g, cfg.niche),
                answer: tpl.answer_template.replace(/\{city\}/g, city).replace(/\{phone\}/g, cfg.phone ?? "").replace(/\{service\}/g, cfg.niche),
              }));

          // Derive mid-CTA text and service area copy (license-aware)
          const midCtaText = hasLicense
            ? `Professional pest control available for homes and businesses in ${city}. Licensed technician dispatched to your location.`
            : `Professional pest control available for homes and businesses in ${city}. Vetted technician dispatched to your location.`;
          const serviceAreaCopy = `Our pest control network covers ${city} and the surrounding ${state} communities. Call to confirm coverage in your neighborhood.`;

          // Resolve hub subheadline from agent-2 headline formulas
          const hubSubheadline = designSystem.copyFramework.headlines.length > 1
            ? resolveHeadlineFormula(designSystem.copyFramework.headlines[1], city, state, cfg.niche, cfg.phone ?? "")
            : hasLicense
              ? `Fast, Licensed Pest Control in ${city}, ${state}`
              : `Fast, Professional Pest Control in ${city}, ${state}`;

          // Resolve additional headlines for section headings
          const headlines = designSystem.copyFramework.headlines;
          const sectionHeadline1 = headlines.length > 2
            ? resolveHeadlineFormula(headlines[2], city, state, cfg.niche, cfg.phone ?? "")
            : `${cfg.niche.charAt(0).toUpperCase() + cfg.niche.slice(1)} Services We Offer`;
          const sectionHeadline2 = headlines.length > 3
            ? resolveHeadlineFormula(headlines[3], city, state, cfg.niche, cfg.phone ?? "")
            : "What Our Customers Say";
          const sectionHeadline3 = headlines.length > 4
            ? resolveHeadlineFormula(headlines[4], city, state, cfg.niche, cfg.phone ?? "")
            : "Frequently Asked Questions";

          // Resolve CTA microcopy and guarantees from agent-2 data
          const hubCtaMicrocopy = designSystem.ctaMicrocopy[0] || "No obligation \u2022 Takes 30 seconds \u2022 Same-day appointments available";
          const hubHeroCtaMicrocopy = designSystem.ctaMicrocopy[0] || hubCtaMicrocopy;
          const hubMidCtaMicrocopy = designSystem.ctaMicrocopy[1] || designSystem.ctaMicrocopy[0] || hubCtaMicrocopy;
          const hubStickyCtaMicrocopy = designSystem.ctaMicrocopy[2] || designSystem.ctaMicrocopy[0] || hubCtaMicrocopy;
          const hubGuarantees = designSystem.guarantees.length > 0
            ? designSystem.guarantees
            : [
                "Professional treatment with proven methods",
                "Qualified local technician network",
                "Transparent pricing with no surprises",
                "Pet and child-safe treatment options",
                "100% satisfaction assurance on all service",
              ];

          // Generate testimonials from agent-2 trust signals
          const hubTestimonials = generateTestimonials(city, undefined, designSystem.copyFramework, hasLicense);

          hugo.writeContentFile(hubSlug, {
            title: finalHubContent.title,
            description: finalHubContent.meta_description,
            h1_title: finalHubContent.title,
            subheadline: hubSubheadline,
            city: city,
            state: state,
            type: "city_hub",
            target_keyword: hubKeyword,
            hero_image: hubHeroImage,
            hero_image_alt: hubHeroImageAlt,
            feature_image: hubFeatureImage,
            schema_template: hubSchemaTemplate,
            seasonal_focus: hubSeasonalSummary,
            approved_routes: approvedRoutes,
            services: hubServices,
            faqs: hubFaqs,
            nearby_cities: nearbyCities,
            disclaimer_text: disclaimerText,
            mid_cta_text: midCtaText,
            service_area_copy: serviceAreaCopy,
            section_headline_1: sectionHeadline1,
            section_headline_2: sectionHeadline2,
            section_headline_3: sectionHeadline3,
            cta_microcopy: hubCtaMicrocopy,
            hero_cta_microcopy: hubHeroCtaMicrocopy,
            mid_cta_microcopy: hubMidCtaMicrocopy,
            sticky_cta_microcopy: hubStickyCtaMicrocopy,
            hero_cta_text: heroCta,
            mid_cta_text_button: midCtaButton,
            sticky_cta_text: stickyCta,
            trust_signals: designSystem.copyFramework.trust_signals.slice(0, 4),
            trust_above_fold: designSystem.designSpec.layout.trust_strategy?.above_fold ?? [],
            trust_mid_page: designSystem.designSpec.layout.trust_strategy?.mid_page ?? [],
            trust_near_cta: designSystem.designSpec.layout.trust_strategy?.near_cta ?? [],
            trust_footer: designSystem.designSpec.layout.trust_strategy?.footer ?? [],
            process_steps: [
              { icon: "📞", title: "Call Us", description: `Describe your ${cfg.niche} problem to a local specialist—no waiting on hold` },
              { icon: "🎯", title: "Get Matched", description: `We connect you with a vetted, ${hasLicense ? "licensed " : ""}professional in ${city}` },
              { icon: "🚗", title: "Professional Service", description: `Your matched technician arrives and handles the problem fast and safely` },
            ],
            guarantees: hubGuarantees,
            testimonials: hubTestimonials,
            hero_bullets: hasLicense
              ? [
                  "Licensed & insured professionals",
                  "Same-day scheduling available",
                  "Child and pet safe treatments",
                ]
              : [
                  "Vetted & insured professionals",
                  "Same-day scheduling available",
                  "Child and pet safe treatments",
                ],
            draft: false,
          }, finalHubContent.content);

          await db.query(
            `INSERT INTO content_items (title, slug, content_type, target_keyword, city, niche, word_count, quality_score)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (slug) DO UPDATE SET word_count = $7, quality_score = $8`,
            [
              finalHubContent.title,
              `${citySlug}`,
              "city_hub",
              hubKeyword,
              city,
              cfg.niche,
              hubQuality.metrics.wordCount,
              JSON.stringify(hubQuality.metrics),
            ]
          );
          await checkpoints.mark(hubCheckpointKey, {
            slug: citySlug,
            city,
          });
        }

        await mapWithConcurrency(
          serviceClusterTypes.slice(0, 5),
          AGENT3_SUBPAGE_CONCURRENCY,
          async (cluster) => {
          const pestType = cluster.cluster_name;
          const pestSlug = resolveServiceSlug(cluster, routeAssignments);
          const subpageCheckpointKey = `subpage:${citySlug}/${pestSlug}`;
          const subpageContentPath = getContentFilePath(cfg.hugoSitePath, `${citySlug}/${pestSlug}.md`);
          const shouldSkipSubpage = await shouldSkipCheckpointedPage(
            db,
            checkpoints,
            subpageCheckpointKey,
            subpageContentPath,
            `${citySlug}/${pestSlug}`
          );
          if (shouldSkipSubpage) {
            console.log(`[Agent 3] Reusing checkpointed subpage ${citySlug}/${pestSlug}`);
            return;
          }
          const serviceSeasonalSummaryText = summarizeSeasonalResearch(
            designSystem.seasonalCalendar,
            cluster.primary_keyword,
            pestType,
            state
          );
          const serviceSeasonalSummary = buildSeasonalFocus(designSystem.seasonalCalendar, cluster.primary_keyword, serviceSeasonalSummaryText, pestType);
          console.log(`[Agent 3] Generating subpage: ${city}/${pestType}...`);
          eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Subpage", detail: `${city}/${pestType}`, timestamp: Date.now() });

          const subPrompt = strategy.getServiceSubpagePrompt(
            {
              city,
              state,
              pestType,
              keyword: cluster.primary_keyword,
              phone: cfg.phone!,
              agent1Summary: `- Approved service keyword: ${cluster.primary_keyword}
- Approved URL slug: /${citySlug}/${pestSlug}/`,
              agent2Summary: (() => {
                const lower = pestType.toLowerCase();
                let emotionalAngle = designSystem.verticalAngles.general_pest;
                if (lower.includes("termite")) emotionalAngle = designSystem.verticalAngles.termites;
                else if (lower.includes("bed") && lower.includes("bug")) emotionalAngle = designSystem.verticalAngles.bed_bugs;
                else if (lower.includes("rodent") || lower.includes("mouse") || lower.includes("mice") || lower.includes("rat") || lower.includes("wildlife")) emotionalAngle = designSystem.verticalAngles.wildlife_rodents;
                else if (lower.includes("ant")) emotionalAngle = designSystem.verticalAngles.ants ?? designSystem.verticalAngles.general_pest;
                else if (lower.includes("spider")) emotionalAngle = designSystem.verticalAngles.spiders ?? designSystem.verticalAngles.general_pest;
                else if (lower.includes("cockroach") || lower.includes("roach")) emotionalAngle = designSystem.verticalAngles.cockroaches ?? designSystem.verticalAngles.general_pest;
                else if (lower.includes("mosquito")) emotionalAngle = designSystem.verticalAngles.mosquitoes ?? designSystem.verticalAngles.general_pest;
                return [
                  "- Archetype: " + designSystem.designSpec.archetype,
                  "- CTA variants: " + designSystem.copyFramework.ctas.join(" | "),
                  "- Guarantees to weave in: " + (designSystem.guarantees.join(" | ") || "satisfaction guaranteed"),
                  "- CTA microcopy: " + (designSystem.ctaMicrocopy[0] || "No obligation, fast local routing"),
                  "- Reading level: Write at " + designSystem.readingLevel.target_grade_min + "th-" + designSystem.readingLevel.target_grade_max + "th grade level. Tone: " + designSystem.readingLevel.tone + ". Short sentences, direct language.",
                  "- Emotional angle for this pest type: " + emotionalAngle,
                  "- PAS scripts (you MUST weave at least one into content): " + (designSystem.copyFramework.pas_scripts.map((s) => "Problem: " + s.problem + " | Agitate: " + s.agitate + " | Solve: " + s.solve).join("; ") || "none"),
                  "- Trust placement hierarchy: Above fold = " + (designSystem.designSpec.layout.trust_strategy?.above_fold ?? []).join(", ") + "; Mid-page = " + (designSystem.designSpec.layout.trust_strategy?.mid_page ?? []).join(", ") + "; Near CTA = " + (designSystem.designSpec.layout.trust_strategy?.near_cta ?? []).join(", "),
                  "- Conversion strategy: Phone mentions minimum " + (designSystem.designSpec.layout.conversion_strategy?.phone_mentions_min ?? 4) + ", no forms allowed",
                ].join("\n");
              })(),
              seasonalGuidance: serviceSeasonalSummaryText,
            },
            strategyContext
          );

          const subReplacements = {
            city,
            state,
            phone: cfg.phone ?? "",
            telephone: cfg.phone ?? "",
            keyword: cluster.primary_keyword,
            pest_type: pestType,
            pest: pestType,
            service: pestType,
            title: `${city} ${pestType}`,
            name: `${city} ${pestType}`,
          };
          const subLogLabel = `[Agent 3][Subpage][${city}/${pestType}]`;
          const subLogger = createVerboseProviderLogger(subLogLabel);
          let rawSubContent;
          try {
            rawSubContent = await llm.call({
              prompt: subPrompt,
              schema: ContentResponseSchema,
              model: "sonnet",
              timeoutMs: AGENT3_CONTENT_TIMEOUT_MS,
              logLabel: subLogLabel,
              onOutput: (chunk, stream) => subLogger.onOutput(chunk, stream),
            });
          } finally {
            subLogger.flush();
          }
          const subContent = applyOfferContentRules(
            resolveGeneratedContentPlaceholders(rawSubContent, subReplacements),
            cfg.offerProfile
          );
          const subSchemaTemplate = resolveSchemaTemplate(
            designSystem.schemaTemplates,
            "service_subpage",
            city,
            state,
            subContent.title,
            subContent.meta_description,
            cfg.phone
          );
          console.log(`[Agent 3] Subpage title for ${city}/${pestType}: ${subContent.title}`);

          let finalSubContent = subContent;
          const minSubWords = designSystem.designSpec.layout?.content_rules?.service_page_words?.min ?? cfg.minWordCountSubpage!;
          console.log(`[Agent 3] Subpage word count minimum: ${minSubWords} (source: ${designSystem.designSpec.layout?.content_rules?.service_page_words?.min ? "agent-2 content_rules" : "config"})`);
          const subPhoneMin = designSystem.designSpec.layout?.conversion_strategy?.phone_mentions_min ?? 3;
          const subSectionRules = (designSystem.designSpec.layout?.section_rules ?? []) as SectionRule[];
          const subHeroImageAlt = `${cluster.primary_keyword} pest control in ${city}`;
          let subQuality = runQualityGate(
            finalSubContent.content,
            city,
            minSubWords,
            [
              finalSubContent.title,
              finalSubContent.meta_description,
              JSON.stringify(subSchemaTemplate),
            ],
            subPhoneMin,
            designSystem.readingLevel,
            subSectionRules,
            {
              title: finalSubContent.title,
              description: finalSubContent.meta_description,
              heroImageAlt: subHeroImageAlt,
              targetKeyword: cluster.primary_keyword,
            }
          );
          if (subQuality.warnings.length > 0) {
            console.warn(`[Agent 3] Subpage QA warnings for ${city}/${pestType}: ${subQuality.warnings.join("; ")}`);
          }
          if (!subQuality.passed) {
            const canAutoRepair = canAutoRepairQaFailures(subQuality.failures);
            if (!canAutoRepair) {
              throw new Error(`Subpage QA failed for ${city}/${pestType}: ${subQuality.failures.join(", ")}`);
            }

            console.warn(
              `[Agent 3] Subpage QA found repairable issues for ${city}/${pestType}: ${subQuality.failures.join(", ")}; attempting repair`
            );
            const repaired = await repairContentForQa(llm, {
              prompt: subPrompt,
              content: finalSubContent,
              city,
              minWordCount: minSubWords,
              supplementalTexts: [JSON.stringify(subSchemaTemplate)],
              failures: subQuality.failures,
              bannedPhrasesFound: subQuality.metrics.bannedPhrasesFound,
              logLabel: `[Agent 3][Subpage repair][${city}/${pestType}]`,
              replacements: subReplacements,
            });
            finalSubContent = repaired.content;
            subQuality = repaired.quality;
            if (!subQuality.passed) {
              throw new Error(
                `Subpage QA failed after repair for ${city}/${pestType}: ${subQuality.failures.join(", ")}`
              );
            }
            console.log(`[Agent 3] Subpage repair passed QA for ${city}/${pestType}`);
          }

          const subHeroImage = await writePageVisual(
            hugo,
            [city, pestType, "hero"],
            pestType,
            cluster.primary_keyword,
            designSystem,
            "service_subpage",
            city,
            pestType
          );
          const subFeatureImage = await writePageVisual(
            hugo,
            [city, pestType, "feature"],
            `${city} ${pestType}`,
            designSystem.secondaryHeadline,
            designSystem,
            "service_subpage",
            city,
            pestType
          );
          // Build subpage FAQs from LLM content or copy framework templates
          const subFaqs = (finalSubContent.faq ?? []).length > 0
            ? finalSubContent.faq!
            : designSystem.copyFramework.faq_templates
                .filter((tpl) => {
                  const lower = tpl.question.toLowerCase();
                  return lower.includes("{service}") || lower.includes("{pest}") || lower.includes("pest");
                })
                .slice(0, 4)
                .map((tpl) => ({
                  question: tpl.question
                    .replace(/\{city\}/g, city)
                    .replace(/\{service\}/g, pestType)
                    .replace(/\{pest\}/g, pestType),
                  answer: tpl.answer_template
                    .replace(/\{city\}/g, city)
                    .replace(/\{phone\}/g, cfg.phone ?? "")
                    .replace(/\{service\}/g, pestType)
                    .replace(/\{pest\}/g, pestType),
                }));

          const subDisclaimerText =
            cfg.offerProfile?.constraints?.required_disclaimer?.trim() ||
            `This website is a referral service connecting consumers with local pest control professionals. We are not a pest control company. By calling the number on this page, your call may be routed to a third-party service provider. Calls may be recorded for quality assurance.`;

          // Resolve subpage subheadline from agent-2 headline formulas
          const subSubheadline = designSystem.copyFramework.headlines.length > 2
            ? resolveHeadlineFormula(designSystem.copyFramework.headlines[2], city, state, serviceSlugToLabel(pestType), cfg.phone ?? "")
            : `Expert ${serviceSlugToLabel(pestType)} Services in ${city}`;

          // Resolve CTA microcopy and guarantees from agent-2 data
          const subCtaMicrocopy = designSystem.ctaMicrocopy[0] || "No obligation \u2022 Takes 30 seconds \u2022 Same-day appointments available";
          const subHeroCtaMicrocopy = designSystem.ctaMicrocopy[0] || subCtaMicrocopy;
          const subMidCtaMicrocopy = designSystem.ctaMicrocopy[1] || designSystem.ctaMicrocopy[0] || subCtaMicrocopy;
          const subStickyCtaMicrocopy = designSystem.ctaMicrocopy[2] || designSystem.ctaMicrocopy[0] || subCtaMicrocopy;
          const subGuarantees = designSystem.guarantees.length > 0
            ? designSystem.guarantees
            : [
                "Professional treatment with proven methods",
                "Transparent pricing with no surprises",
                "Pet and child-safe treatment options",
              ];

          // Generate subpage testimonials
          const subTestimonials = generateTestimonials(city, pestType, designSystem.copyFramework, hasLicense);

          // Build hero_bullets for subpage (license-conditional)
          const subHeroBullets = hasLicense
            ? [
                `Licensed ${serviceSlugToLabel(pestType).toLowerCase()} specialists`,
                "Same-day inspection available",
                "Child and pet safe treatments",
              ]
            : [
                `Experienced ${serviceSlugToLabel(pestType).toLowerCase()} specialists`,
                "Same-day inspection available",
                "Child and pet safe treatments",
              ];

          hugo.writeContentFile(`${citySlug}/${pestSlug}.md`, {
            title: finalSubContent.title,
            description: finalSubContent.meta_description,
            h1_title: finalSubContent.title,
            subheadline: subSubheadline,
            city: city,
            state: state,
            region: `${city}, ${state}`,
            pest_type: pestType,
            pest_name: serviceSlugToLabel(pestType),
            pest_icon: getPestIcon(pestType),
            type: "service_subpage",
            target_keyword: cluster.primary_keyword,
            hero_image: subHeroImage,
            hero_image_alt: subHeroImageAlt,
            feature_image: subFeatureImage,
            schema_template: subSchemaTemplate,
            seasonal_focus: serviceSeasonalSummary,
            faqs: subFaqs,
            disclaimer_text: subDisclaimerText,
            service_cities: cityRows.map((row: any) => String(row.city ?? "").trim()).slice(0, 10),
            cta_microcopy: subCtaMicrocopy,
            hero_cta_microcopy: subHeroCtaMicrocopy,
            mid_cta_microcopy: subMidCtaMicrocopy,
            sticky_cta_microcopy: subStickyCtaMicrocopy,
            hero_cta_text: heroCta,
            mid_cta_text_button: midCtaButton,
            sticky_cta_text: stickyCta,
            trust_signals: designSystem.copyFramework.trust_signals.slice(0, 4),
            trust_above_fold: designSystem.designSpec.layout.trust_strategy?.above_fold ?? [],
            trust_mid_page: designSystem.designSpec.layout.trust_strategy?.mid_page ?? [],
            trust_near_cta: designSystem.designSpec.layout.trust_strategy?.near_cta ?? [],
            trust_footer: designSystem.designSpec.layout.trust_strategy?.footer ?? [],
            guarantees: subGuarantees,
            testimonials: subTestimonials,
            hero_bullets: subHeroBullets,
            draft: false,
          }, finalSubContent.content);

          await db.query(
            `INSERT INTO content_items (title, slug, content_type, target_keyword, pest_type, city, niche, word_count, quality_score)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (slug) DO UPDATE SET word_count = $8, quality_score = $9`,
            [
              finalSubContent.title,
              `${citySlug}/${pestSlug}`,
              "service_subpage",
              cluster.primary_keyword,
              pestType,
              city,
              cfg.niche,
              subQuality.metrics.wordCount,
              JSON.stringify(subQuality.metrics),
            ]
          );
          await checkpoints.mark(subpageCheckpointKey, {
            slug: `${citySlug}/${pestSlug}`,
            city,
            pestType,
          });
          console.log(`[Agent 3] Saved page ${citySlug}/${pestSlug} (${subQuality.metrics.wordCount} words)`);
          }
        );

        const pageUrl = `https://extermanation.com/${citySlug}/`;
        await db.query(
          `INSERT INTO pages (url, slug, city, state, niche, target_keyword, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (slug) DO NOTHING`,
          [pageUrl, citySlug, city, state, cfg.niche, hubKeyword]
        );
        await checkpoints.mark(`city:${citySlug}`, {
          city,
          state,
          routeCount: serviceClusterTypes.slice(0, 5).length,
        });
        console.log(`[Agent 3] Registered page ${pageUrl}`);
      };

      await scheduleWithVerboseLimiter(cfg.deployLimiter, `${cityRow.city}, ${cityRow.state}`, processCity);
    }

    // Write site-level navigation data (footer links for services + cities)
    const allServiceSlugs = new Set<string>();
    const allCitySlugs: Array<{ name: string; slug: string }> = [];
    for (const cityRow of cityRows) {
      const rowCity = String(cityRow.city ?? "").trim();
      const rowCitySlug = slugify(rowCity);
      allCitySlugs.push({ name: rowCity, slug: rowCitySlug });

      const rowClusterIds = Array.isArray(cityRow.keyword_cluster_ids) ? cityRow.keyword_cluster_ids : [];
      const rowClusters = (await db.query("SELECT * FROM keyword_clusters WHERE id = ANY($1::uuid[])", [rowClusterIds])).rows;
      const rowRoutes = deriveRouteAssignments(cityRow.url_mapping, rowCitySlug);
      for (const cluster of rowClusters) {
        if (
          isServiceCluster(cluster, rowCity, "") &&
          isAllowedServiceCluster(cluster, cfg.offerProfile, cfg.verticalProfile)
        ) {
          const svcSlug = resolveServiceSlug(cluster, rowRoutes);
          const svcName = serviceSlugToLabel(String(cluster.cluster_name ?? ""));
          allServiceSlugs.add(`${svcSlug}|${svcName}`);
        }
      }
    }

    const uniqueServices = [...allServiceSlugs].slice(0, 10).map((entry) => {
      const [svcSlug, svcName] = entry.split("|");
      return { slug: svcSlug, name: svcName };
    });

    // Write Hugo data files for footer navigation
    const dataDir = path.join(cfg.hugoSitePath, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "nav.json"),
      JSON.stringify({
        pest_services: uniqueServices,
        service_cities: allCitySlugs.slice(0, 12),
      }, null, 2),
      "utf-8"
    );

    // Update config.toml with site-level params for footer
    const configPath = path.join(cfg.hugoSitePath, "config.toml");
    let configContent = fs.readFileSync(configPath, "utf-8");

    // Remove fake license number if present
    configContent = configContent.replace(/\s*license_number\s*=\s*"[^"]*"\s*\n?/g, "\n");

    // Ensure has_license = false is set
    if (!configContent.includes("has_license")) {
      configContent = configContent.replace(
        "[params]\n",
        "[params]\n  has_license = false\n"
      );
    }

    // Ensure review_rating and review_count are present
    if (!configContent.includes("review_rating")) {
      configContent = configContent.replace(
        "[params]\n",
        "[params]\n  review_rating = \"4.9\"\n"
      );
    }
    if (!configContent.includes("review_count")) {
      configContent = configContent.replace(
        "[params]\n",
        "[params]\n  review_count = \"200\"\n"
      );
    }

    fs.writeFileSync(configPath, configContent, "utf-8");

    // Extract business name from config for homepage generation
    const businessName = configContent.match(/business_name\s*=\s*"([^"]*)"/)?.[1] ?? "Extermanation";

    // Generate site-level homepage (content/_index.md) aggregating all cities and services
    const hasLicenseSite = false; // Set true when business obtains a pest control license
    const homepageDisclaimer =
      cfg.offerProfile?.constraints?.required_disclaimer?.trim() ||
      "This website is a referral service connecting consumers with local pest control professionals. We are not a pest control company. By calling the number on this page, your call may be routed to a third-party service provider. Calls may be recorded for quality assurance. The specific services, pricing, scheduling, and service guarantees are determined by the independent provider dispatched to your location.";

    // Build services grid for homepage from aggregated unique services
    const firstCitySlug = allCitySlugs.length > 0 ? allCitySlugs[0].slug : "";
    const homepageServices = uniqueServices.slice(0, 8).map((svc) => ({
      icon: getPestIcon(svc.slug),
      name: svc.name,
      description: getPestDescription(svc.name),
      link: `/${firstCitySlug}/${svc.slug}/`,
    }));

    // Build nearby cities for homepage from all processed cities
    const homepageNearbyCities = allCitySlugs.slice(0, 12).map((c) => ({
      name: c.name,
      slug: c.slug,
    }));

    // Derive state list for homepage copy
    const uniqueStates = [...new Set(cityRows.map((row: any) => String(row.state ?? "").trim()).filter(Boolean))];
    const stateList = uniqueStates.length > 0 ? uniqueStates.join(", ") : "your area";

    // Build homepage FAQs
    const homepageFaqs = [
      { question: "What areas do you serve?", answer: `Our pest control network covers communities across ${stateList}. We currently serve ${allCitySlugs.map((c) => c.name).join(", ")}, with more locations coming soon.` },
      { question: "How quickly can I get service?", answer: "Most service requests are scheduled within 24-48 hours. Same-day service may be available depending on technician availability in your area." },
      { question: "What pests do you treat?", answer: "Our network of local professionals handles common household pests including rodents (mice and rats), silverfish, ants, spiders, cockroaches, termites, and more. Call to discuss your specific pest issue." },
      { question: "Are the treatments safe for kids and pets?", answer: "Yes. The technicians in our network use EPA-registered products and follow all safety protocols. Treatments are designed to be effective against pests while remaining safe for your family and pets." },
      { question: "How much does pest control cost?", answer: "Pricing varies based on the type of pest, severity of the infestation, and size of your property. The service provider dispatched to your location will provide a specific quote before beginning work." },
      { question: "What if the pests come back after treatment?", answer: "Many providers in our network offer follow-up treatments or satisfaction guarantees. Ask your technician about their specific warranty and retreatment policies." },
    ];

    const homepageContent = `${businessName} connects homeowners with vetted, local pest control professionals who know your area. Whether you're dealing with rodents in the attic, ants in the kitchen, or termites threatening your foundation, our network of qualified technicians provides fast, effective treatment using EPA-registered products that are safe for your family and pets.

## Coverage Across ${uniqueStates.length > 1 ? `${uniqueStates.length} States` : "Your Area"}

Our service network spans communities in ${stateList}. Each technician in our network is locally based, insured, and experienced with the specific pest pressures in your region.

## How It Works

Call the number on this page and describe your pest problem. We match you with a qualified local technician who can schedule an inspection — often within 24-48 hours. Your technician handles everything from initial assessment through treatment and follow-up, with transparent pricing provided before any work begins.

## Commitment to Safety

Every technician in our network uses EPA-registered products applied according to manufacturer specifications. Treatments are selected to be effective against target pests while minimizing exposure risk to children, pets, and the surrounding environment.`;

    // Resolve homepage CTA microcopy and guarantees from agent-2 data
    const homepageCtaMicrocopy = designSystem.ctaMicrocopy[0] || "No obligation \u2022 Takes 30 seconds \u2022 Same-day appointments available";
    const homepageGuarantees = designSystem.guarantees.length > 0
      ? designSystem.guarantees
      : [
          "Professional treatment with proven methods",
          "Qualified local technician network",
          "Transparent pricing with no surprises",
          "Pet and child-safe treatment options",
          "100% satisfaction assurance on all service",
        ];
    const homepageTestimonials = generateTestimonials(
      allCitySlugs[0]?.name ?? "Your City",
      undefined,
      designSystem.copyFramework,
      hasLicenseSite
    );

    hugo.writeContentFile("_index.md", {
      title: `Professional Pest Control Services | ${businessName}`,
      description: `${businessName} connects you with vetted local pest control professionals in ${stateList}. Same-day scheduling available. Call now.`,
      type: "city_hub",
      h1_title: "Professional Pest Control Services",
      subheadline: hasLicenseSite
        ? `Fast, Licensed Pest Control Across ${stateList}`
        : `Fast, Reliable Pest Control Across ${stateList}`,
      hero_image: `/images/generated/${firstCitySlug}-hub-hero.svg`,
      feature_image: `/images/generated/${firstCitySlug}-hub-feature.svg`,
      hero_bullets: hasLicenseSite
        ? ["Licensed & insured professionals", "Same-day scheduling available", "Child and pet safe treatments"]
        : ["Vetted & insured professionals", "Same-day scheduling available", "Child and pet safe treatments"],
      services: homepageServices,
      faqs: homepageFaqs,
      nearby_cities: homepageNearbyCities,
      disclaimer_text: homepageDisclaimer,
      mid_cta_text: hasLicenseSite
        ? "Professional pest control available for homes and businesses across our service areas. Licensed technician dispatched to your location."
        : "Professional pest control available for homes and businesses across our service areas. Vetted technician dispatched to your location.",
      service_area_copy: `Our pest control network covers communities in ${stateList}. Call to confirm coverage in your neighborhood.`,
      cta_microcopy: homepageCtaMicrocopy,
      guarantees: homepageGuarantees,
      testimonials: homepageTestimonials,
      draft: false,
    }, homepageContent);
    console.log("[Agent 3] Generated homepage _index.md");

    console.log("[Agent 3] Building Hugo site...");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Hugo build", detail: "Compiling site", timestamp: Date.now() });
    await updateSiteBuildRecord(db, buildRecord.id, "BUILDING");
    const buildResult = await hugo.buildSite();
    if (!buildResult.success) {
      throw new Error(`Hugo build failed: ${buildResult.output}`);
    }
    console.log("[Agent 3] Hugo build successful");

    await updateSiteBuildRecord(db, buildRecord.id, "QA_CHECK", {
      buildOutput: {
        build_success: true,
        build_output_preview: buildResult.output.slice(0, 500),
      },
    });
    const artifactQa = runBuiltArtifactQa(
      cfg.hugoSitePath,
      cityRows.map((row) => slugify(String(row.city ?? "")))
    );
    if (!artifactQa.passed) {
      throw new Error(`Built artifact QA failed: ${artifactQa.failures.join(", ")}`);
    }

    const netlifySiteId = process.env.NETLIFY_SITE_ID;
    if (netlifySiteId) {
      console.log("[Agent 3] Creating Netlify draft deploy...");
      eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Draft deploy", detail: "Creating preview deploy", timestamp: Date.now() });
      await updateSiteBuildRecord(db, buildRecord.id, "DEPLOYING_DRAFT");
      const draftResult = await hugo.deployDraftSite(netlifySiteId);
      if (!draftResult.success || !draftResult.url) {
        throw new Error(`Netlify draft deploy failed: ${draftResult.output}`);
      }

      await updateSiteBuildRecord(db, buildRecord.id, "QA_CHECK", {
        draftUrl: draftResult.url,
        buildOutput: {
          draft_output_preview: draftResult.output.slice(0, 500),
        },
      });
      await runDraftPreviewQa(draftResult.url);

      console.log("[Agent 3] Publishing Netlify deploy...");
      eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Publish deploy", detail: "Promoting preview to production", timestamp: Date.now() });
      await updateSiteBuildRecord(db, buildRecord.id, "DEPLOYING_LIVE", {
        draftUrl: draftResult.url,
      });
      const publishResult = await hugo.publishSite(netlifySiteId);
      if (!publishResult.success || !publishResult.url) {
        throw new Error(`Netlify publish failed: ${publishResult.output}`);
      }

      console.log(`[Agent 3] Deployed to: ${publishResult.url}`);
      eventBus.emitEvent({
        type: "site_deployed",
        url: publishResult.url,
        siteId: netlifySiteId,
        city: "all",
        agent: "agent-3",
        timestamp: Date.now(),
      });

      const baseUrl = publishResult.url.replace(/\/$/, "");
      for (const cityRow of cityRows) {
        const citySlug = slugify(cityRow.city);
        await db.query(
          "UPDATE pages SET url = $1 WHERE slug = $2 AND niche = $3",
          [`${baseUrl}/${citySlug}/`, citySlug, cfg.niche]
        );
      }

      await updateSiteBuildRecord(db, buildRecord.id, "LIVE", {
        draftUrl: draftResult.url,
        liveUrl: publishResult.url,
        buildOutput: {
          publish_output_preview: publishResult.output.slice(0, 500),
        },
        completed: true,
      });
    } else {
      console.log("[Agent 3] NETLIFY_SITE_ID not set, skipping deploy");
      await updateSiteBuildRecord(db, buildRecord.id, "LIVE", {
        buildOutput: {
          deploy_skipped: true,
        },
        completed: true,
      });
    }

    await checkpoints.mark("completed", {
      cityCount: cityRows.length,
    });
    console.log("[Agent 3] Site build complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateSiteBuildRecord(db, buildRecord.id, "FAILED", {
      error: message,
      completed: true,
    });
    throw err;
  }
}

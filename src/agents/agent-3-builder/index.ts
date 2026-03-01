import { z } from "zod/v4";
import path from "node:path";
import type { LlmClient } from "../../shared/cli/llm-client.js";
import type { DbClient } from "../../shared/db/client.js";
import { createHugoManager } from "./hugo-manager.js";
import { runQualityGate } from "./quality-gate.js";
import { slugify } from "../agent-1-keywords/index.js";
import { eventBus } from "../../shared/events/event-bus.js";
import { CITY_HUB_PROMPT, SERVICE_SUBPAGE_PROMPT } from "./prompts.js";
import type { DesignSpec } from "../../shared/schemas/design-specs.js";
import type { CopyFramework } from "../../shared/schemas/copy-frameworks.js";

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

export interface Agent3Config {
  niche: string;
  hugoSitePath: string;
  phone: string;
  minWordCountHub: number;
  minWordCountSubpage: number;
}

const DEFAULT_CONFIG: Partial<Agent3Config> = {
  phone: process.env.BUSINESS_PHONE ?? "(555) 123-4567",
  minWordCountHub: 800,
  minWordCountSubpage: 1200,
};

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
  trustSignals: string[];
  faqLead: { question: string; answer_template: string } | null;
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

function writeGeneratedVisual(
  hugo: ReturnType<typeof createHugoManager>,
  parts: string[],
  title: string,
  subtitle: string,
  design: DesignSystemContext
): string {
  const assetPath = `images/generated/${createAssetSlug(parts)}.svg`;
  hugo.writeStaticFile(
    assetPath,
    createDeterministicImageSvg(
      title,
      subtitle,
      design.primary,
      design.secondary,
      design.tertiary,
      design.highlight
    )
  );
  return `/${assetPath}`;
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
  return {
    niche,
    archetype: typeof row.archetype === "string" ? row.archetype : "local-service",
    layout: asObject<Record<string, unknown>>(row.layout, {}),
    components: asObject<Array<Record<string, unknown>>>(row.components, []),
    colors: asObject<Record<string, string>>(row.colors, {}),
    typography: asObject<Record<string, string>>(row.typography, {}),
    responsive_breakpoints: asObject<Record<string, number>>(row.responsive_breakpoints, {}),
  };
}

function normalizeCopyFramework(row: Record<string, unknown>, niche: string): CopyFramework {
  return {
    niche,
    headlines: asStringArray(row.headlines),
    ctas: asStringArray(row.ctas),
    trust_signals: asStringArray(row.trust_signals),
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
  description: string
): Record<string, unknown> {
  const candidates =
    pageType === "city_hub"
      ? ["city_hub", "cityHub", "local_business", "localBusiness", "hub"]
      : ["service_subpage", "serviceSubpage", "service", "pest_service", "pestService"];

  for (const key of candidates) {
    const template = schemaTemplates[key];
    if (template && typeof template === "object" && !Array.isArray(template)) {
      return {
        ...(template as Record<string, unknown>),
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
      };
    }
  }

  return {
    "@context": "https://schema.org",
    "@type": pageType === "city_hub" ? "PestControlService" : "Service",
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
  };
}

function summarizeSeasonalResearch(
  seasonalCalendar: DesignSystemContext["seasonalCalendar"],
  keyword: string,
  pestType?: string
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
      return `${month.name}: focus on ${pests || "priority pests"}; message = ${month.messaging_priority}`;
    })
    .join(" | ");
}

async function applyDesignSystem(
  niche: string,
  db: DbClient,
  hugo: ReturnType<typeof createHugoManager>
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
  const headingFont = designSpec.typography.heading || designSpec.typography.display || "\"Avenir Next\", \"Segoe UI\", sans-serif";
  const bodyFont = designSpec.typography.body || designSpec.typography.copy || "\"Trebuchet MS\", \"Segoe UI\", sans-serif";
  const heroHeadline =
    copyFramework.headlines[0] ||
    `${designSpec.archetype.replace(/[_-]+/g, " ")} ${layoutLabels[0] || "service"} flow`;
  const secondaryHeadline =
    copyFramework.headlines[1] ||
    `${componentLabels.slice(0, 2).join(" and ") || "High-converting service"} sections shaped by design research`;
  const primaryCta = copyFramework.ctas[0] || `Call for ${designSpec.archetype.replace(/[_-]+/g, " ")}`;
  const secondaryCta = copyFramework.ctas[1] || `Review ${layoutLabels[1] || "service"} details`;
  const trustSignals = copyFramework.trust_signals.slice(0, 3);
  const trustMarkup = trustSignals
    .map((signal) => `<li>${escapeHtml(signal)}</li>`)
    .join("\n");
  const faqLead = copyFramework.faq_templates[0] ?? null;
  const faqQuestion = faqLead?.question || `How is the ${designSpec.archetype.replace(/[_-]+/g, " ")} process structured?`;
  const faqAnswer = faqLead?.answer_template || `The page layout follows ${layoutLabels.join(", ") || "the researched service sequence"} so visitors can move from urgency to proof to action without friction.`;

  hugo.writeTemplate("_default/baseof.html", `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ if .Title }}{{ .Title }} | {{ end }}{{ .Site.Title }}</title>
  <meta name="description" content="{{ .Params.description | default .Site.Params.tagline }}">
  <link rel="canonical" href="{{ .Permalink }}">
  <link rel="stylesheet" href="/css/main.css">
  <link rel="stylesheet" href="/css/generated-theme.css">
  {{ block "head" . }}{{ end }}
</head>
<body class="brand-shell">
  {{ partial "header.html" . }}
  <main>
    {{ block "main" . }}{{ end }}
  </main>
  {{ partial "footer.html" . }}
  {{ partial "cta-sticky.html" . }}
  {{ block "schema" . }}
    {{ partial "schema-jsonld.html" . }}
  {{ end }}
</body>
</html>`);

  hugo.writeTemplate("_default/list.html", `{{ define "main" }}
<article class="city-hub city-hub-premium">
  <section class="hero hero-split">
    <div class="container hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">{{ .Params.city }} {{ .Params.state }} Pest Coverage</p>
        <h1>{{ .Title }}</h1>
        <p class="hero-subtitle">{{ .Params.description | default "${escapeHtml(heroHeadline)}" }}</p>
        <p class="hero-support">${escapeHtml(secondaryHeadline)}</p>
        <div class="hero-actions">
          <a href="tel:{{ .Site.Params.phone_raw }}" class="cta-button cta-primary">${escapeHtml(primaryCta)}</a>
          <a href="#service-grid" class="cta-button cta-secondary">${escapeHtml(secondaryCta)}</a>
        </div>
        {{ partial "cta-badge.html" . }}
      </div>
      <div class="hero-visual">
        <img src="{{ .Params.hero_image }}" alt="{{ .Title }}">
      </div>
    </div>
  </section>

  <section class="trust-ribbon">
    <div class="container">
      <ul class="trust-points">
        ${trustMarkup}
      </ul>
    </div>
  </section>

  <section class="content-body">
    <div class="container content-grid">
      <div class="content-main">
        {{ .Content }}
      </div>
      <aside class="content-side">
        <div class="side-card">
          <h2>{{ .Params.city }} Search Intent Snapshot</h2>
          <p>The city hub is assembled around the primary keyword <strong>{{ .Params.target_keyword }}</strong> and uses the researched layout order to move visitors from local problem awareness into the strongest conversion action.</p>
        </div>
        <div class="side-card side-image">
          <img src="{{ .Params.feature_image }}" alt="{{ .Title }}">
        </div>
      </aside>
    </div>
  </section>

  {{ if .Pages }}
  <section id="service-grid" class="services-grid services-grid-premium">
    <div class="container">
      <div class="section-intro">
        <p class="eyebrow">Popular Treatments</p>
        <h2>Targeted Services{{ if .Params.city }} in {{ .Params.city }}{{ end }}</h2>
      </div>
      <div class="grid">
        {{ range .Pages }}
        <a href="{{ .Permalink }}" class="service-card premium-card">
          <p class="service-label">Fast Response</p>
          <h3>{{ .Title }}</h3>
          <p>{{ .Params.description }}</p>
          <span class="card-cta">View Service Plan &rarr;</span>
        </a>
        {{ end }}
      </div>
    </div>
  </section>
  {{ end }}

  <section class="faq-section spotlight-faq">
    <div class="container">
      <div class="faq-highlight">
        <p class="eyebrow">Common Question</p>
        <h2>${escapeHtml(faqQuestion)}</h2>
        <p>${escapeHtml(faqAnswer)}</p>
      </div>
    </div>
  </section>

  <section class="cta-section cta-section-premium">
    <div class="container">
      <p class="eyebrow">Need Help Today?</p>
      <h2>Talk to a local team that moves fast.</h2>
      <p>Call for same-day scheduling, property-specific recommendations, and clear next steps before we start treatment.</p>
      <a href="tel:{{ .Site.Params.phone_raw }}" class="cta-button cta-primary">Call {{ .Site.Params.phone }}</a>
      {{ partial "cta-badge.html" . }}
    </div>
  </section>
</article>
{{ end }}`);

  hugo.writeTemplate("_default/single.html", `{{ define "main" }}
<article class="service-page service-page-premium">
  <section class="hero hero-split service-hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">{{ .Params.city }} {{ .Params.state }} Service</p>
        <h1>{{ .Title }}</h1>
        {{ if .Params.city }}
        <p class="hero-subtitle">{{ .Params.pest_type | default "Pest" }} control built around the keyword target <strong>{{ .Params.target_keyword }}</strong> and the same conversion pattern defined in design research.</p>
        {{ end }}
        <div class="hero-actions">
          <a href="tel:{{ .Site.Params.phone_raw }}" class="cta-button cta-primary">${escapeHtml(primaryCta)}</a>
          <a href="#service-content" class="cta-button cta-secondary">See Treatment Details</a>
        </div>
        {{ partial "cta-badge.html" . }}
      </div>
      <div class="hero-visual">
        <img src="{{ .Params.feature_image }}" alt="{{ .Title }}">
      </div>
    </div>
  </section>

  <section class="trust-ribbon">
    <div class="container">
      <ul class="trust-points">
        ${trustMarkup}
      </ul>
    </div>
  </section>

  <section id="service-content" class="content-body">
    <div class="container content-grid">
      <div class="content-main">
        {{ .Content }}
      </div>
      <aside class="content-side">
        <div class="side-card">
          <h2>Keyword-Driven Page Focus</h2>
          <p>This service page exists because Agent 1 identified <strong>{{ .Params.target_keyword }}</strong> as a standalone search theme with its own treatment intent and URL path.</p>
        </div>
        <div class="side-card">
          <h2>Design System Components</h2>
          <ul class="mini-list">
            <li>${escapeHtml(componentLabels[0] || "Hero section")}</li>
            <li>${escapeHtml(componentLabels[1] || "Trust block")}</li>
            <li>${escapeHtml(componentLabels[2] || "Primary CTA block")}</li>
          </ul>
        </div>
      </aside>
    </div>
  </section>

  {{ if .Params.faq }}
  <section class="faq-section">
    <div class="container">
      <h2>Frequently Asked Questions</h2>
      {{ partial "faq.html" . }}
    </div>
  </section>
  {{ end }}

  <section class="cta-section cta-section-premium">
    <div class="container">
      <p class="eyebrow">Same-Day Scheduling</p>
      <h2>Get ahead of the infestation before it spreads.</h2>
      <p>Call now for a fast inspection, practical treatment options, and a plan that fits your home or commercial property.</p>
      <a href="tel:{{ .Site.Params.phone_raw }}" class="cta-button cta-primary">Call {{ .Site.Params.phone }}</a>
      {{ partial "cta-badge.html" . }}
    </div>
  </section>

  <nav class="breadcrumb">
    <div class="container">
      <a href="/">Home</a> &rsaquo;
      {{ if .Parent }}
      <a href="{{ .Parent.Permalink }}">{{ .Parent.Title }}</a> &rsaquo;
      {{ end }}
      <span>{{ .Title }}</span>
    </div>
  </nav>
</article>
{{ end }}`);

  hugo.writeStaticFile("css/generated-theme.css", `:root {
  --color-primary: ${primary};
  --color-primary-dark: ${primary};
  --color-secondary: ${secondary};
  --color-bg-alt: ${tertiary};
  --color-success: ${highlight};
  --font-heading: ${headingFont};
  --font-body: ${bodyFont};
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
}`);

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

export async function runAgent3(
  config: Agent3Config,
  llm: LlmClient,
  db: DbClient
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const hugo = createHugoManager(cfg.hugoSitePath);
  hugo.ensureProject();
  const designSystem = await applyDesignSystem(cfg.niche, db, hugo);

  console.log(`[Agent 3] Starting site build for ${cfg.niche}`);
  eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Starting", detail: cfg.niche, timestamp: Date.now() });

  // Get cities from city_keyword_map
  const citiesResult = await db.query(
    "SELECT city, state, url_mapping, keyword_cluster_ids FROM city_keyword_map WHERE niche = $1",
    [cfg.niche]
  );

  if (citiesResult.rows.length === 0) {
    console.log("[Agent 3] No cities found in keyword map. Run Agent 1 first.");
    return;
  }

  for (const cityRow of citiesResult.rows) {
    const { city, state } = cityRow;
    const citySlug = slugify(city);
    const routeAssignments = deriveRouteAssignments(cityRow.url_mapping, citySlug);
    const approvedRoutes = routeAssignments.map((assignment) => assignment.routePath);
    console.log(`[Agent 3] Building pages for ${city}, ${state}`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Building city", detail: `${city}, ${state}`, timestamp: Date.now() });

    // Get the exact keyword clusters approved by Agent 1 for this city.
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

    // Generate city hub page
    const hubKeyword = orderedClusters.find(
      (c: any) => c.intent === "transactional"
    )?.primary_keyword ?? `${city} ${cfg.niche}`;
    const hubSeasonalSummary = summarizeSeasonalResearch(
      designSystem.seasonalCalendar,
      hubKeyword
    );

    console.log(`[Agent 3] Generating hub page for ${city}...`);
    eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Hub page", detail: city, timestamp: Date.now() });
    const hubPrompt = `${CITY_HUB_PROMPT
      .replace(/\{city\}/g, city)
      .replace(/\{state\}/g, state)
      .replace(/\{keyword\}/g, hubKeyword)
      .replace(/\{phone\}/g, cfg.phone!)}

Agent 1 city keyword map (authoritative):
- Approved hub keyword: ${hubKeyword}
- Approved route keys: ${approvedRoutes.join(", ") || "none"}
- Approved cluster count: ${orderedClusters.length}

Agent 2 design research (authoritative):
- Archetype: ${designSystem.designSpec.archetype}
- Layout sequence: ${Object.keys(designSystem.designSpec.layout).join(", ")}
- CTA variants: ${designSystem.copyFramework.ctas.join(" | ")}
- Trust signals: ${designSystem.copyFramework.trust_signals.join(" | ")}
- Seasonal guidance: ${hubSeasonalSummary}`;

    const hubContent = await llm.call({
      prompt: hubPrompt,
      schema: ContentResponseSchema,
    });
    console.log(`[Agent 3] Hub page title: ${hubContent.title}`);
    console.log(
      `[Agent 3] Hub headings: ${(hubContent.headings ?? []).slice(0, 4).join(" | ") || "none"}`
    );

    // Quality gate
    const hubQuality = runQualityGate(hubContent.content, city, cfg.minWordCountHub!);
    if (!hubQuality.passed) {
      console.warn(`[Agent 3] Hub page quality gate failed for ${city}: ${hubQuality.failures.join(", ")}`);
    }

    // Write hub page
    const hubSlug = `${citySlug}/_index.md`;
    const hubHeroImage = writeGeneratedVisual(
      hugo,
      [city, "hub", "hero"],
      city,
      hubKeyword,
      designSystem
    );
    const hubFeatureImage = writeGeneratedVisual(
      hugo,
      [city, "hub", "feature"],
      `${city} Coverage`,
      designSystem.heroHeadline,
      designSystem
    );
    hugo.writeContentFile(hubSlug, {
      title: hubContent.title,
      description: hubContent.meta_description,
      city: city,
      state: state,
      type: "city_hub",
      target_keyword: hubKeyword,
      hero_image: hubHeroImage,
      feature_image: hubFeatureImage,
      schema_template: resolveSchemaTemplate(
        designSystem.schemaTemplates,
        "city_hub",
        city,
        state,
        hubContent.title,
        hubContent.meta_description
      ),
      seasonal_focus: hubSeasonalSummary,
      approved_routes: approvedRoutes,
      draft: false,
    }, hubContent.content);

    // Record in DB
    await db.query(
      `INSERT INTO content_items (title, slug, content_type, target_keyword, city, niche, word_count, quality_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET word_count = $7, quality_score = $8`,
      [
        hubContent.title,
        `${citySlug}`,
        "city_hub",
        hubKeyword,
        city,
        cfg.niche,
        hubQuality.metrics.wordCount,
        JSON.stringify(hubQuality.metrics),
      ]
    );

    // Generate service subpages for pest-specific clusters
    const serviceClusterTypes = orderedClusters.filter(
      (c: any) => isServiceCluster(c, city, hubKeyword) && findRouteAssignment(c, routeAssignments)
    );

    for (const cluster of serviceClusterTypes.slice(0, 5)) {
      const pestType = cluster.cluster_name;
      const pestSlug = resolveServiceSlug(cluster, routeAssignments);
      const serviceSeasonalSummary = summarizeSeasonalResearch(
        designSystem.seasonalCalendar,
        cluster.primary_keyword,
        pestType
      );
      console.log(`[Agent 3] Generating subpage: ${city}/${pestType}...`);
      eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Subpage", detail: `${city}/${pestType}`, timestamp: Date.now() });

      const subPrompt = `${SERVICE_SUBPAGE_PROMPT
        .replace(/\{city\}/g, city)
        .replace(/\{state\}/g, state)
        .replace(/\{pest_type\}/g, pestType)
        .replace(/\{keyword\}/g, cluster.primary_keyword)
        .replace(/\{phone\}/g, cfg.phone!)}

Agent 1 city keyword map (authoritative):
- Approved service keyword: ${cluster.primary_keyword}
- Approved URL slug: /${citySlug}/${pestSlug}/

Agent 2 design research (authoritative):
- Archetype: ${designSystem.designSpec.archetype}
- PAS sequence: ${designSystem.copyFramework.pas_scripts.map((item) => item.problem).join(" | ")}
- CTA variants: ${designSystem.copyFramework.ctas.join(" | ")}
- Seasonal guidance: ${serviceSeasonalSummary}`;

      const subContent = await llm.call({
        prompt: subPrompt,
        schema: ContentResponseSchema,
      });
      console.log(`[Agent 3] Subpage title for ${city}/${pestType}: ${subContent.title}`);

      const subQuality = runQualityGate(subContent.content, city, cfg.minWordCountSubpage!);
      if (!subQuality.passed) {
        console.warn(`[Agent 3] Subpage quality gate failed for ${city}/${pestType}: ${subQuality.failures.join(", ")}`);
      }

      const subHeroImage = writeGeneratedVisual(
        hugo,
        [city, pestType, "hero"],
        pestType,
        cluster.primary_keyword,
        designSystem
      );
      const subFeatureImage = writeGeneratedVisual(
        hugo,
        [city, pestType, "feature"],
        `${city} ${pestType}`,
        designSystem.secondaryHeadline,
        designSystem
      );
      hugo.writeContentFile(`${citySlug}/${pestSlug}.md`, {
        title: subContent.title,
        description: subContent.meta_description,
        city: city,
        state: state,
        pest_type: pestType,
        type: "service_subpage",
        target_keyword: cluster.primary_keyword,
        hero_image: subHeroImage,
        feature_image: subFeatureImage,
        schema_template: resolveSchemaTemplate(
          designSystem.schemaTemplates,
          "service_subpage",
          city,
          state,
          subContent.title,
          subContent.meta_description
        ),
        seasonal_focus: serviceSeasonalSummary,
        draft: false,
      }, subContent.content);

      await db.query(
        `INSERT INTO content_items (title, slug, content_type, target_keyword, pest_type, city, niche, word_count, quality_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (slug) DO UPDATE SET word_count = $8, quality_score = $9`,
        [
          subContent.title,
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
      console.log(`[Agent 3] Saved page ${citySlug}/${pestSlug} (${subQuality.metrics.wordCount} words)`);
    }

    // Register pages
    const pageUrl = `https://extermanation.com/${citySlug}/`;
    await db.query(
      `INSERT INTO pages (url, slug, city, state, niche, target_keyword, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (slug) DO NOTHING`,
      [pageUrl, citySlug, city, state, cfg.niche, hubKeyword]
    );
    console.log(`[Agent 3] Registered page ${pageUrl}`);
  }

  // Build Hugo site
  console.log("[Agent 3] Building Hugo site...");
  eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Hugo build", detail: "Compiling site", timestamp: Date.now() });
  const buildResult = await hugo.buildSite();
  if (buildResult.success) {
    console.log("[Agent 3] Hugo build successful");
  } else {
    console.warn(`[Agent 3] Hugo build failed: ${buildResult.output}`);
  }

  // Deploy to Netlify if site ID is configured
  const netlifySiteId = process.env.NETLIFY_SITE_ID;
  if (netlifySiteId && buildResult.success) {
    console.log("[Agent 3] Deploying to Netlify...");
    eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Deploying", detail: "Pushing to Netlify", timestamp: Date.now() });

    const deployResult = await hugo.deploySite(netlifySiteId);
    if (deployResult.success && deployResult.url) {
      console.log(`[Agent 3] Deployed to: ${deployResult.url}`);
      eventBus.emitEvent({
        type: "site_deployed",
        url: deployResult.url,
        siteId: netlifySiteId,
        city: "all",
        agent: "agent-3",
        timestamp: Date.now(),
      });

      // Update page URLs in DB with actual deploy URL
      const baseUrl = deployResult.url.replace(/\/$/, "");
      for (const cityRow of citiesResult.rows) {
        const citySlug = slugify(cityRow.city);
        await db.query(
          "UPDATE pages SET url = $1 WHERE slug = $2 AND niche = $3",
          [`${baseUrl}/${citySlug}/`, citySlug, cfg.niche]
        );
      }
    } else {
      console.warn(`[Agent 3] Netlify deploy failed: ${deployResult.output}`);
      eventBus.emitEvent({ type: "agent_step", agent: "agent-3", step: "Deploy failed", detail: deployResult.output.slice(0, 100), timestamp: Date.now() });
    }
  } else if (!netlifySiteId) {
    console.log("[Agent 3] NETLIFY_SITE_ID not set, skipping deploy");
  }

  console.log("[Agent 3] Site build complete");
}

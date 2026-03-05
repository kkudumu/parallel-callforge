/**
 * Tests for hugo-manager.ts — YAML frontmatter serialization
 *
 * Covers the writeContentFile YAML generation including the gapplan.md fixes:
 * - Empty arrays/objects must stay inline ([] / {}) — not on separate line
 * - Process steps (array of objects with emoji) serialize correctly
 * - Nested objects (schema_template, seasonal_focus) serialize correctly
 * - Special characters in keys (@context, @type) serialize correctly
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHugoManager } from "./hugo-manager.js";

let tmpDir: string;
let hugo: ReturnType<typeof createHugoManager>;

// Minimal Hugo project skeleton required by ensureProject()
function scaffoldHugoSite(dir: string): void {
  fs.mkdirSync(path.join(dir, "content"), { recursive: true });
  fs.mkdirSync(path.join(dir, "layouts", "_default"), { recursive: true });
  fs.mkdirSync(path.join(dir, "static", "css"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.toml"),
    `baseURL = "http://example.com"\nlanguageCode = "en-us"\ntitle = "Test Site"\n[params]\n  phone = "(555) 000-0000"\n`,
    "utf-8"
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "callforge-hugo-manager-test-"));
  scaffoldHugoSite(tmpDir);
  hugo = createHugoManager(tmpDir);
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) { /* ignore */ }
});

// ─────────────────────────────────────────────────────────────────
// Helper: read generated content file
// ─────────────────────────────────────────────────────────────────

function readContentFile(relPath: string): string {
  return fs.readFileSync(path.join(tmpDir, "content", relPath), "utf-8");
}

function parseFrontmatterBlock(raw: string): string {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("No frontmatter block found in file");
  return match[1];
}

// ─────────────────────────────────────────────────────────────────
// Basic serialization
// ─────────────────────────────────────────────────────────────────

describe("hugo-manager writeContentFile — YAML serialization", () => {
  it("writes string values as quoted YAML", () => {
    hugo.writeContentFile("test/_index.md", { title: "Santa Cruz Pest Control", city: "Santa Cruz" }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"title": "Santa Cruz Pest Control"');
    expect(fm).toContain('"city": "Santa Cruz"');
  });

  // ─────────────────────────────────────────────────────────────────
  // Bug #6: Control characters in string values must be escaped
  // Newlines in LLM-generated strings (title, description, etc.)
  // break Hugo's YAML parser with "did not find expected key"
  // ─────────────────────────────────────────────────────────────────

  it("escapes newline (\\n) in string values — unescaped causes Hugo YAML parse failure", () => {
    hugo.writeContentFile("test/_index.md", {
      title: "Line 1\nLine 2",
      city: "Santa Cruz",
    }, "body");
    const raw = readContentFile("test/_index.md");
    const fm = parseFrontmatterBlock(raw);
    // The YAML must NOT contain a literal newline inside the "title" value
    // A literal newline before another quoted key ("city":) makes Hugo fail with
    // "did not find expected key"
    expect(fm).not.toMatch(/"title": "Line 1\nLine 2"/);
    // It must use YAML-safe escape \n instead
    expect(fm).toMatch(/"title": "Line 1\\nLine 2"/);
  });

  it("escapes carriage return + newline (\\r\\n) in string values", () => {
    hugo.writeContentFile("test/_index.md", {
      description: "Windows\r\nline endings",
      city: "Santa Cruz",
    }, "body");
    const raw = readContentFile("test/_index.md");
    // No literal CR or LF characters should be inside the quoted "description" value
    const titleLine = raw.split("\n").find((l) => l.includes('"description"'));
    expect(titleLine).toBeDefined();
    // The line must not end mid-string — it must be a complete "key": "value" on one line
    expect(titleLine).toMatch(/^"description": ".+"$/);
  });

  it("escapes tab (\\t) in string values", () => {
    hugo.writeContentFile("test/_index.md", {
      title: "Before\tAfter",
    }, "body");
    const raw = readContentFile("test/_index.md");
    const fm = parseFrontmatterBlock(raw);
    expect(fm).not.toMatch(/"title": "Before\tAfter"/);
    expect(fm).toMatch(/"title": "Before\\tAfter"/);
  });

  it("writes boolean values unquoted", () => {
    hugo.writeContentFile("test/_index.md", { draft: false, published: true }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"draft": false');
    expect(fm).toContain('"published": true');
  });

  it("writes number values unquoted", () => {
    hugo.writeContentFile("test/_index.md", { weight: 10, score: 4.5 }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"weight": 10');
    expect(fm).toContain('"score": 4.5');
  });

  it("escapes double quotes inside string values", () => {
    hugo.writeContentFile("test/_index.md", { title: 'The "best" service' }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"title": "The \\"best\\" service"');
  });

  it("writes the content body after the closing ---", () => {
    hugo.writeContentFile("test/_index.md", { title: "Test" }, "This is body content.");
    const raw = readContentFile("test/_index.md");
    expect(raw).toMatch(/---\n\nThis is body content\./);
  });

  // ─────────────────────────────────────────────────────────────────
  // Gapplan regression: empty arrays and objects must stay inline
  // ─────────────────────────────────────────────────────────────────

  it("serializes empty arrays inline (not on separate line) — prevents Hugo YAML parse error", () => {
    hugo.writeContentFile("test/_index.md", {
      trust_above_fold: [],
      trust_mid_page: [],
      trust_near_cta: [],
      trust_footer: [],
      nearby_cities: [],
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    // Must be key: [] on the SAME line — never key:\n[]
    expect(fm).toContain('"trust_above_fold": []');
    expect(fm).toContain('"trust_mid_page": []');
    expect(fm).toContain('"trust_near_cta": []');
    expect(fm).toContain('"trust_footer": []');
    expect(fm).toContain('"nearby_cities": []');
    // Ensure the broken form never appears
    expect(fm).not.toMatch(/"trust_above_fold":\s*\n\s*\[\]/);
  });

  it("serializes empty objects inline", () => {
    hugo.writeContentFile("test/_index.md", { meta: {} }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"meta": {}');
  });

  it("serializes non-empty arrays with proper indentation", () => {
    hugo.writeContentFile("test/_index.md", {
      trust_signals: ["Licensed & Insured", "Same-day Service", "Vetted Pros"],
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('- "Licensed & Insured"');
    expect(fm).toContain('- "Same-day Service"');
    expect(fm).toContain('- "Vetted Pros"');
  });

  // ─────────────────────────────────────────────────────────────────
  // Gapplan: process_steps with emoji icons (Task 3.3)
  // ─────────────────────────────────────────────────────────────────

  it("serializes process_steps array of objects with emoji correctly", () => {
    hugo.writeContentFile("test/_index.md", {
      process_steps: [
        { icon: "📞", title: "Call Us", description: "Speak with a local specialist" },
        { icon: "🎯", title: "Get Matched", description: "Connected with a vetted pro" },
        { icon: "🚗", title: "Service", description: "Your technician arrives fast" },
      ],
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"icon": "📞"');
    expect(fm).toContain('"title": "Call Us"');
    expect(fm).toContain('"icon": "🎯"');
    expect(fm).toContain('"icon": "🚗"');
    expect(fm).toContain('"description": "Speak with a local specialist"');
  });

  it("serializes process_steps with em-dash in description without YAML error", () => {
    hugo.writeContentFile("test/_index.md", {
      process_steps: [
        { icon: "📞", title: "Call Us", description: "No waiting on hold—connect directly" },
      ],
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain("No waiting on hold\u2014connect directly");
  });

  // ─────────────────────────────────────────────────────────────────
  // Gapplan: schema_template with @context / @type keys (Task 2.1)
  // ─────────────────────────────────────────────────────────────────

  it("serializes schema_template object with @-prefixed keys", () => {
    hugo.writeContentFile("test/_index.md", {
      schema_template: {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        additionalType: "https://www.productontology.org/id/Pest_control",
      },
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"@context": "https://schema.org"');
    expect(fm).toContain('"@type": "LocalBusiness"');
    expect(fm).toContain('"additionalType": "https://www.productontology.org/id/Pest_control"');
  });

  // ─────────────────────────────────────────────────────────────────
  // Gapplan: seasonal_focus object (Task 2.6)
  // ─────────────────────────────────────────────────────────────────

  it("serializes seasonal_focus object including ⚠️ icon", () => {
    hugo.writeContentFile("test/_index.md", {
      seasonal_focus: {
        message: "prevent spring infestation growth",
        season_name: "March",
        seasonal_pests: ["termites", "ants"],
        icon: "⚠️",
      },
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"message": "prevent spring infestation growth"');
    expect(fm).toContain('"season_name": "March"');
    expect(fm).toContain('"icon": "⚠️"');
    expect(fm).toContain('- "termites"');
    expect(fm).toContain('- "ants"');
  });

  // ─────────────────────────────────────────────────────────────────
  // Gapplan: trust signals as array of strings (Task 2.3)
  // ─────────────────────────────────────────────────────────────────

  it("serializes trust_signals string array", () => {
    hugo.writeContentFile("test/_index.md", {
      trust_signals: ["Licensed local technicians", "Same-day appointments", "Satisfaction guaranteed"],
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('- "Licensed local technicians"');
    expect(fm).toContain('- "Same-day appointments"');
    expect(fm).toContain('- "Satisfaction guaranteed"');
  });

  // ─────────────────────────────────────────────────────────────────
  // Gapplan: hero image alt text (Task 4.3)
  // ─────────────────────────────────────────────────────────────────

  it("serializes hero_image_alt string field", () => {
    hugo.writeContentFile("test/_index.md", {
      hero_image_alt: "Santa Cruz termite inspection technician",
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"hero_image_alt": "Santa Cruz termite inspection technician"');
  });

  // ─────────────────────────────────────────────────────────────────
  // Gapplan: CTA text fields (Task 2.2)
  // ─────────────────────────────────────────────────────────────────

  it("serializes hero_cta_text, mid_cta_text_button, sticky_cta_text", () => {
    hugo.writeContentFile("test/_index.md", {
      hero_cta_text: "Request Same-Day Service",
      mid_cta_text_button: "Book a Free Inspection",
      sticky_cta_text: "Call Now",
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"hero_cta_text": "Request Same-Day Service"');
    expect(fm).toContain('"mid_cta_text_button": "Book a Free Inspection"');
    expect(fm).toContain('"sticky_cta_text": "Call Now"');
  });

  // ─────────────────────────────────────────────────────────────────
  // Gapplan: section headlines (Task 3.5)
  // ─────────────────────────────────────────────────────────────────

  it("serializes section_headline_1/2/3 fields", () => {
    hugo.writeContentFile("test/_index.md", {
      section_headline_1: "Pest Control Services We Offer",
      section_headline_2: "What Our Customers Say",
      section_headline_3: "Frequently Asked Questions",
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"section_headline_1": "Pest Control Services We Offer"');
    expect(fm).toContain('"section_headline_2": "What Our Customers Say"');
    expect(fm).toContain('"section_headline_3": "Frequently Asked Questions"');
  });

  // ─────────────────────────────────────────────────────────────────
  // Gapplan: CTA microcopy positions (Task 3.6)
  // ─────────────────────────────────────────────────────────────────

  it("serializes hero/mid/sticky cta microcopy fields", () => {
    hugo.writeContentFile("test/_index.md", {
      hero_cta_microcopy: "No obligation • Takes 30 seconds",
      mid_cta_microcopy: "Free estimates available",
      sticky_cta_microcopy: "Call anytime",
    }, "body");
    const fm = parseFrontmatterBlock(readContentFile("test/_index.md"));
    expect(fm).toContain('"hero_cta_microcopy": "No obligation \u2022 Takes 30 seconds"');
    expect(fm).toContain('"mid_cta_microcopy": "Free estimates available"');
    expect(fm).toContain('"sticky_cta_microcopy": "Call anytime"');
  });

  // ─────────────────────────────────────────────────────────────────
  // Full representative frontmatter — validates Hugo can parse it
  // ─────────────────────────────────────────────────────────────────

  it("produces valid YAML for a full representative hub page frontmatter", () => {
    // Write a frontmatter representative of what processCity generates
    hugo.writeContentFile("santa-cruz/_index.md", {
      title: "Santa Cruz Pest Control Services",
      description: "Professional pest control in Santa Cruz, CA. Same-day service available.",
      h1_title: "Santa Cruz Pest Control Services",
      subheadline: "Fast local pest control with clear next steps",
      city: "Santa Cruz",
      state: "CA",
      type: "city_hub",
      target_keyword: "Santa Cruz pest control",
      hero_image: "/images/pest-control-hero.jpg",
      hero_image_alt: "Santa Cruz pest control technician",
      schema_template: { "@context": "https://schema.org", "@type": "LocalBusiness" },
      seasonal_focus: { message: "prevent infestation", season_name: "March", seasonal_pests: ["termites"], icon: "⚠️" },
      approved_routes: ["/santa-cruz/", "/santa-cruz/termite-control/"],
      services: [{ icon: "🪲", name: "Pest Control", description: "Professional elimination.", link: "/santa-cruz/pest-control/" }],
      faqs: [{ question: "How does your first inspection work?", answer: "We inspect and explain before starting." }],
      nearby_cities: [],
      disclaimer_text: "This website is a referral service.",
      trust_signals: ["Licensed & Insured", "Same-day Service"],
      trust_above_fold: [],
      trust_mid_page: [],
      trust_near_cta: [],
      trust_footer: [],
      process_steps: [
        { icon: "📞", title: "Call Us", description: "Describe your problem—no waiting on hold" },
        { icon: "🎯", title: "Get Matched", description: "We connect you with a vetted professional" },
        { icon: "🚗", title: "Service", description: "Your technician arrives fast" },
      ],
      hero_cta_text: "Request Same-Day Service",
      mid_cta_text_button: "Book a Free Inspection",
      sticky_cta_text: "Call Now",
      section_headline_1: "Pest Control Services We Offer",
      section_headline_2: "What Our Customers Say",
      section_headline_3: "Frequently Asked Questions",
      cta_microcopy: "No obligation • Takes 30 seconds",
      guarantees: ["Professional treatment", "Qualified technician network"],
      hero_bullets: ["Vetted & insured professionals", "Same-day scheduling"],
      draft: false,
    }, "Professional pest control services in Santa Cruz.");

    const raw = readContentFile("santa-cruz/_index.md");
    // File must start and end with proper delimiters
    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw).toContain("\n---\n\n");

    const fm = parseFrontmatterBlock(raw);
    // Key required fields present
    expect(fm).toContain('"title": "Santa Cruz Pest Control Services"');
    // Empty arrays inline
    expect(fm).toContain('"trust_above_fold": []');
    expect(fm).toContain('"nearby_cities": []');
    // Non-empty arrays serialized with items
    expect(fm).toContain('- "Licensed & Insured"');
    // Nested objects
    expect(fm).toContain('"@context": "https://schema.org"');
    expect(fm).toContain('"icon": "⚠️"');
    // Process steps
    expect(fm).toContain('"icon": "📞"');
    expect(fm).toContain('"title": "Call Us"');
  });
});

// ─────────────────────────────────────────────────────────────────
// CSS variable generation — Task 1.1, 1.4, 3.2 (via integration check)
// ─────────────────────────────────────────────────────────────────

describe("hugo-manager writeStaticFile — CSS variable generation", () => {
  it("writes generated-theme.css with gapplan color variables", () => {
    const cssContent = `
:root {
  --color-primary: #FF6B00;
  --color-secondary: #1A1A2E;
  --color-cta-primary: #FF6B00;
  --color-cta-primary-hover: #E85D04;
  --color-urgency: #C8290F;
  --color-text: #1A1A1A;
  --color-text-muted: #5C5C5C;
  --color-trust: #2D7A3A;
  --color-background: #FFFFFF;
  --color-surface: #F7F7F5;
  --font-size-body-desktop: 16px;
  --font-size-body-mobile: 14px;
  --font-size-cta: 18px;
}
`.trim();
    hugo.writeStaticFile("css/generated-theme.css", cssContent);
    const written = fs.readFileSync(path.join(tmpDir, "static", "css", "generated-theme.css"), "utf-8");
    // Task 1.1: 10 color variables
    expect(written).toContain("--color-cta-primary:");
    expect(written).toContain("--color-cta-primary-hover:");
    expect(written).toContain("--color-urgency:");
    expect(written).toContain("--color-text:");
    expect(written).toContain("--color-text-muted:");
    expect(written).toContain("--color-trust:");
    expect(written).toContain("--color-background:");
    expect(written).toContain("--color-surface:");
    // Task 1.4: typography sizes
    expect(written).toContain("--font-size-body-desktop:");
    expect(written).toContain("--font-size-body-mobile:");
    expect(written).toContain("--font-size-cta:");
  });
});

// ─────────────────────────────────────────────────────────────────
// Nav data file — Task 2.4
// ─────────────────────────────────────────────────────────────────

describe("hugo-manager writeDataFile — nav data generation", () => {
  it("writes nav.json with pest_services and service_cities", () => {
    const navData = JSON.stringify({
      pest_services: [
        { slug: "termite-control", name: "Termite Control" },
        { slug: "ant-control", name: "Ant Control" },
      ],
      service_cities: [
        { name: "Santa Cruz", slug: "santa-cruz" },
        { name: "Deland", slug: "deland" },
      ],
    }, null, 2);

    hugo.writeDataFile("nav.json", navData);

    const dataPath = path.join(tmpDir, "data", "nav.json");
    expect(fs.existsSync(dataPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    expect(parsed.pest_services).toHaveLength(2);
    expect(parsed.pest_services[0].slug).toBe("termite-control");
    expect(parsed.service_cities).toHaveLength(2);
    expect(parsed.service_cities[0].name).toBe("Santa Cruz");
  });
});

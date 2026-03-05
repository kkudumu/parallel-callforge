import { readResearchFile, validateResearchFile, buildResearchContext } from "./research-reader.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = join(tmpdir(), "research-reader-test-" + Date.now());

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const VALID_FILE = `# Competitor Research — pest control

**Subagent:** competitor-analyzer
**Sources consulted:** 87
**Date:** 2026-03-05

## Key Findings

### Top CTA Pattern
**Evidence:** https://example.com/pest-control
**Data:** 76% of top-ranking sites use sticky click-to-call on mobile
**Implication:** Sticky bar is mandatory, not optional

### Hero Section Layout
**Evidence:** https://example.com/hero-cta-study
**Data:** Sites with phone number in hero convert 23% higher than those without
**Implication:** Phone number must be in the hero section, above the fold

### Trust Signal Placement
**Evidence:** https://example.com/trust-signals
**Data:** BBB badge, license number, and years in business in header increases trust 31%
**Implication:** Trust signals belong in the header or immediately below hero

### CTA Button Color
**Evidence:** https://example.com/button-color-test
**Data:** Orange CTA buttons outperform green by 14% for local service pages
**Implication:** Use orange (#FF6B35) for primary CTA buttons

### Mobile Click-to-Call
**Evidence:** https://example.com/mobile-ux-study
**Data:** 78% of pest control conversions originate from mobile click-to-call
**Implication:** Mobile sticky bar with click-to-call is non-negotiable

### Form vs Phone CTA
**Evidence:** https://example.com/form-vs-phone
**Data:** Phone CTAs convert 3.2x higher than form submissions for emergency pest calls
**Implication:** Remove all web forms; replace with phone CTAs only

### Section Order
**Evidence:** https://example.com/section-order-test
**Data:** Hero → Trust bar → Services → Testimonials → FAQ → CTA footer outperforms alternatives
**Implication:** Use this exact section order as the default layout

### Social Proof Volume
**Evidence:** https://example.com/review-count-study
**Data:** Sites showing 50+ reviews convert 18% higher than those showing fewer
**Implication:** Display aggregate review count prominently; aim for 50+ visible

### Guarantee Copy
**Evidence:** https://example.com/guarantee-test
**Data:** "100% satisfaction guarantee or we return free" copy increases CVR by 19%
**Implication:** Include satisfaction guarantee with free re-treatment language

### Emergency Intent Keywords
**Evidence:** https://example.com/keyword-intent-study
**Data:** "same day pest control" and "24 hour exterminator" convert at 2x the rate of general terms
**Implication:** Include emergency availability language in hero headline

### Above-the-Fold Phone Number
**Evidence:** https://example.com/above-fold-study
**Data:** Displaying the phone number above the fold with click-to-call increases mobile conversions by 34% compared to sites that bury contact info lower on the page
**Implication:** Phone number must be prominently displayed in the sticky header and hero section with a tap-to-call link on all mobile viewports

### Competitor Service Page Structure
**Evidence:** https://example.com/service-page-analysis
**Data:** 91% of top-converting pest control service pages include a numbered process section explaining the treatment steps customers will experience
**Implication:** Add a 3-step or 4-step numbered process section beneath the primary hero CTA to reduce friction and answer the "what happens next" question before customers call

## Source Index
- https://example.com/pest-control — top pest control site with sticky CTA
- https://example.com/hero-cta-study — study on hero section phone CTA placement
- https://example.com/trust-signals — research on trust signal placement effectiveness
- https://example.com/button-color-test — A/B test comparing button colors for local services
- https://example.com/mobile-ux-study — mobile conversion analysis for pest control sites
- https://example.com/form-vs-phone — comparison of form vs phone call conversion rates
- https://example.com/section-order-test — landing page section order optimization study
- https://example.com/review-count-study — social proof volume impact on conversion rates
- https://example.com/guarantee-test — guarantee copy impact on pest control site CVR
- https://example.com/keyword-intent-study — emergency intent keyword conversion analysis
`;

describe("readResearchFile", () => {
  it("reads an existing file", () => {
    const path = join(TMP, "competitors.md");
    writeFileSync(path, VALID_FILE, "utf8");
    const content = readResearchFile(path);
    expect(content).toBe(VALID_FILE);
  });

  it("returns null for missing file", () => {
    const content = readResearchFile(join(TMP, "missing.md"));
    expect(content).toBeNull();
  });
});

describe("validateResearchFile", () => {
  it("passes a valid file", () => {
    expect(validateResearchFile(VALID_FILE)).toBe(true);
  });

  it("fails a file with no Source Index", () => {
    const bad = VALID_FILE.replace("## Source Index", "## Sources");
    expect(validateResearchFile(bad)).toBe(false);
  });

  it("fails a file shorter than 500 words", () => {
    expect(validateResearchFile("too short")).toBe(false);
  });
});

describe("buildResearchContext", () => {
  it("combines multiple files with section headers", () => {
    const files = { competitors: VALID_FILE, cro: VALID_FILE };
    const ctx = buildResearchContext(files);
    expect(ctx).toContain("=== COMPETITORS RESEARCH ===");
    expect(ctx).toContain("=== CRO RESEARCH ===");
  });

  it("omits null files", () => {
    const ctx = buildResearchContext({ competitors: VALID_FILE, schema: null });
    expect(ctx).toContain("=== COMPETITORS RESEARCH ===");
    expect(ctx).not.toContain("=== SCHEMA RESEARCH ===");
  });
});

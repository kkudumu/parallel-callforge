# Pipeline Conversion Gap Fix Plan

**Generated**: 2026-03-03
**Scope**: 40 gaps identified across Agent-2 -> Agent-3 -> Hugo Templates pipeline
**Cross-referenced**: `designdecisions.md` confirms none are intentional; all align with stated near-term goals
**Business model**: Pay-per-call -- every fix is measured by its impact on phone call conversions

---

## Execution Strategy

- **4 sprints** organized by severity and dependency order
- Each task has a **verification step** to confirm correctness before moving on
- Sprint 1 tasks are independent and parallelizable
- Later sprints build on earlier fixes

---

## Sprint 1: Simple Critical & High Fixes (Highest ROI)

These are all 1-2 file changes under 20 lines each. Maximum conversion impact for minimum effort.

### Task 1.1: Map All 10 Agent-2 Colors to CSS Variables
**Gap**: #8 (Critical)
**Files**: `src/agents/agent-3-builder/index.ts`
**What**:
1. Read the CSS generation section (lines ~1455-1691) in `index.ts`
2. Find where CSS `:root` variables are set from `designSystem` colors
3. Currently only 4 colors mapped: primary, secondary, tertiary (background), highlight (success)
4. Add the missing 6 CSS variable mappings:
   - `--color-cta-primary: ${designSpec.colors.cta_primary}`
   - `--color-cta-primary-hover: ${designSpec.colors.cta_primary_hover}`
   - `--color-urgency: ${designSpec.colors.urgency}`
   - `--color-text: ${designSpec.colors.text}`
   - `--color-text-muted: ${designSpec.colors.text_muted}`
   - `--color-trust: ${designSpec.colors.trust}`
5. Also add `--color-background: ${designSpec.colors.background}` and `--color-surface: ${designSpec.colors.surface}`
**Verify**: Run `grep -c "color-" hugo-site/static/css/generated-theme.css` after a test build to confirm all 10+ variables present

### Task 1.2: Use Agent-2 Word Count Rules Instead of Config
**Gap**: #10 (High)
**Files**: `src/agents/agent-3-builder/index.ts`
**What**:
1. Find QA gate invocations for hub pages (~line 2137) and subpages (~line 2418)
2. Currently uses `minWordCountHub` and `minWordCountSubpage` from Agent-3 Config
3. Change to use `designSystem.designSpec.layout.content_rules.city_hub_words.min` for hub pages
4. Change to use `designSystem.designSpec.layout.content_rules.service_page_words.min` for subpages
5. Keep Config values as fallbacks if content_rules is missing: `const minWords = designSystem.designSpec.layout?.content_rules?.city_hub_words?.min ?? minWordCountHub`
**Verify**: Add a log line showing which word count source was used; run pipeline for one city and confirm Agent-2 values appear in logs

### Task 1.3: Add Phone Number Count Validation to QA Gate
**Gap**: #4 (Critical)
**Files**: `src/agents/agent-3-builder/quality-gate.ts`, `src/agents/agent-3-builder/index.ts`
**What**:
1. Read `quality-gate.ts` to understand the validation function signature and failure format
2. Add a new check: count occurrences of phone-related patterns in content (phone number digits, `tel:` references, "call" CTA text)
3. Accept a `phoneMinMentions` parameter (default 3 from `designSpec.layout.conversion_strategy.phone_mentions_min`)
4. Fail if phone mentions < phoneMinMentions
5. In `index.ts`, pass `designSystem.designSpec.layout.conversion_strategy.phone_mentions_min` to the QA gate calls
**Verify**: Temporarily set phone_mentions_min to a high number (e.g., 50) and confirm QA fails

### Task 1.4: Add Typography Sizes to Generated CSS
**Gap**: #14 (High)
**Files**: `src/agents/agent-3-builder/index.ts`
**What**:
1. In the CSS generation section, after the font-family variables, add:
   - `--font-size-body-desktop: ${designSpec.typography.body_size_desktop || '16px'}`
   - `--font-size-body-mobile: ${designSpec.typography.body_size_mobile || '14px'}`
   - `--font-size-cta: ${designSpec.typography.cta_size || '18px'}`
2. Add a media query block in generated CSS that applies mobile font size at the mobile breakpoint
**Verify**: Inspect generated-theme.css for the new variables

### Task 1.5: Extend Banned Phrase Check to Frontmatter Fields
**Gap**: #15 (High)
**Files**: `src/agents/agent-3-builder/quality-gate.ts`, `src/agents/agent-3-builder/index.ts`
**What**:
1. In `index.ts`, when calling `runQualityGate()`, currently only body content is passed
2. Also pass a `supplementalTexts` array that includes: title, description, h1_title, subheadline
3. In `quality-gate.ts`, extend banned phrase checking to also scan supplemental texts
4. If banned phrase found in a frontmatter field, include the field name in the failure message
5. Auto-repair should also handle frontmatter banned phrases
**Verify**: Inject a known banned phrase into a test title and confirm QA catches it

---

## Sprint 2: Medium-Complexity Critical & High Fixes

These require 2-4 file changes each, typically 30-80 lines.

### Task 2.1: Fix Schema Markup Key Mismatch and Render on Pages
**Gap**: #3 (Critical)
**Files**: `hugo-site/layouts/_default/baseof.html`, `src/agents/agent-3-builder/index.ts`
**What**:
1. In `baseof.html`, find the schema rendering block (~line 368): `{{ if .Params.schema }}`
2. Change to: `{{ if .Params.schema_template }}` to match the frontmatter key Agent-3 actually sets
3. Verify the `resolveSchemaTemplate()` function output format — it should produce valid JSON-LD
4. Ensure the template outputs the schema properly: `{{ .Params.schema_template | jsonify | safeHTML }}`
5. For FAQ schema: add inline FAQPage JSON-LD generation in list.html and single.html where FAQs are rendered, using the `.Params.faqs` array
6. The FAQPage schema should be generated from the page's actual FAQ content, not from the orphaned partial
**Verify**: Build site, inspect page source for `<script type="application/ld+json">` blocks containing LocalBusiness and FAQPage schemas

### Task 2.2: Make CTA Button Text Dynamic from Agent-2
**Gap**: #1 (Critical)
**Files**: `src/agents/agent-3-builder/index.ts`, `hugo-site/layouts/_default/list.html`, `hugo-site/layouts/_default/single.html`, `hugo-site/layouts/_default/baseof.html`
**What**:
1. In `index.ts` frontmatter assembly (hub ~line 2258, subpage ~line 2534), add new fields:
   - `hero_cta_text`: from `designSystem.primaryCta` (copyFramework.ctas[0])
   - `mid_cta_text_button`: from `designSystem.secondaryCta` (copyFramework.ctas[1])
   - `sticky_cta_text`: from copyFramework.ctas[2] or fallback to "Call Now"
2. In `list.html`, replace hardcoded "Call a Local Pro Now" with `{{ .Params.hero_cta_text | default "Call a Local Pro Now" }}`
3. In `list.html`, replace hardcoded "Connect With a Pro in Your Area" with `{{ .Params.mid_cta_text_button | default "Connect With a Pro" }}`
4. In `single.html`, replace hardcoded "Talk to a Local Expert" with `{{ .Params.mid_cta_text_button | default "Talk to a Local Expert" }}`
5. In `baseof.html`, replace hardcoded "Call Now" in sticky bar with `{{ .Params.sticky_cta_text | default "Call Now" }}`
6. Keep `| default` fallbacks so existing pages without these fields still work
**Verify**: Build site, inspect rendered HTML for dynamic CTA text matching Agent-2 output

### Task 2.3: Make Trust Signals Dynamic from Agent-2
**Gap**: #5 (Critical)
**Files**: `src/agents/agent-3-builder/index.ts`, `hugo-site/layouts/_default/list.html`, `hugo-site/layouts/_default/single.html`
**What**:
1. In `index.ts` frontmatter assembly, add:
   - `trust_signals`: `designSystem.trustSignals` (array of strings from copyFramework)
2. In `list.html` and `single.html`, find the trust bar section (4-column grid with hardcoded icons)
3. Replace hardcoded items with a loop: `{{ range .Params.trust_signals }}` rendering each signal
4. Keep the 4-icon layout structure but make text dynamic
5. Provide default fallback array: `{{ $signals := .Params.trust_signals | default (slice "Licensed & Insured" "4.9 Star Rating" "Guaranteed Service" "Family Safe") }}`
**Verify**: Check rendered HTML trust bar contains Agent-2 trust signals instead of hardcoded text

### Task 2.4: Generate Navigation Data File
**Gap**: #6 (Critical)
**Files**: `src/agents/agent-3-builder/index.ts`, `src/agents/agent-3-builder/hugo-manager.ts`
**What**:
1. In Agent-3's build process, after all city/service pages are determined, generate `hugo-site/data/nav.yml`
2. Structure:
   ```yaml
   pest_services:
     - name: "Termite Control"
       slug: "termite-control"
     - name: "Rodent Control"
       slug: "rodent-control"
   service_cities:
     - name: "Shawnee"
       slug: "shawnee"
     - name: "Deland"
       slug: "deland"
   ```
3. Derive `pest_services` from the unique service types across all keyword clusters
4. Derive `service_cities` from the cities being built
5. Write this file before Hugo build step so it's available during rendering
**Verify**: Build site, inspect footer HTML for populated navigation links

### Task 2.5: Add Compliance Disclosures
**Gap**: #7 (Critical)
**Files**: `hugo-site/layouts/_default/baseof.html`, `hugo-site/layouts/_default/list.html`, `hugo-site/layouts/_default/single.html`, `hugo-site/config.toml`
**What**:
1. Add TCPA micro-text near each click-to-call button in templates:
   - Text: `{{ .Site.Params.tcpa_text | default "By calling, you consent to being contacted by a service professional." }}`
   - Style: small font (10px), muted color, directly below CTA buttons
2. Add "Do Not Sell My Personal Information" link to rendered footer in `baseof.html`:
   - Currently only in orphaned `footer.html` partial
   - Add after the existing Privacy Policy link in baseof's inline footer
3. Add `tcpa_text` parameter to `config.toml` with a default value
4. Add `privacy_policy_url`, `terms_url`, `do_not_sell_url` to config.toml if not present
5. Add state-specific licensing disclaimer support: `{{ if .Site.Params.license_disclaimer }}{{ .Site.Params.license_disclaimer }}{{ end }}`
**Verify**: Inspect rendered page for TCPA text near CTAs, "Do Not Sell" link in footer

### Task 2.6: Add Seasonal Content Banner to Templates
**Gap**: #16 (High)
**Files**: `hugo-site/layouts/_default/list.html`, `hugo-site/layouts/_default/single.html`, `src/agents/agent-3-builder/index.ts`
**What**:
1. In `index.ts`, the `seasonal_focus` frontmatter field already contains seasonal data. Ensure it includes:
   - `season_name`: current season/month name
   - `seasonal_message`: formatted urgency message (e.g., "Peak Termite Season - Act Now")
   - `seasonal_pests`: array of active pests this season
2. In `list.html` and `single.html`, add a seasonal banner section after the hero:
   ```html
   {{ if .Params.seasonal_focus }}
   <div class="seasonal-banner">
     <span class="seasonal-icon">{{ .Params.seasonal_focus.icon | default "⚠️" }}</span>
     <span>{{ .Params.seasonal_focus.message }}</span>
   </div>
   {{ end }}
   ```
3. Style the banner: full-width, urgency color background, white text, centered
4. Use `--color-urgency` CSS variable from Sprint 1 Task 1.1
**Verify**: Build site and check pages display seasonal banner with current month's pest data

### Task 2.7: Add Reading Grade Validation to QA Gate
**Gap**: #13 (High)
**Files**: `src/agents/agent-3-builder/quality-gate.ts`
**What**:
1. Implement a Flesch-Kincaid grade level calculator function:
   - Count sentences (split on `.`, `!`, `?`)
   - Count words
   - Count syllables (approximation: count vowel groups per word)
   - FK grade = 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
2. Add a new QA check: compare FK grade against `readingLevel.target_grade_min` and `target_grade_max`
3. If grade is outside range, add a warning (not a hard fail) with the actual grade and target range
4. Log the grade level for every page for monitoring
**Verify**: Test with known text samples and verify grade calculation is within 1 grade of expected

### Task 2.8: Enforce Section Rules in QA Gate
**Gap**: #17 (High)
**Files**: `src/agents/agent-3-builder/quality-gate.ts`, `src/agents/agent-3-builder/index.ts`
**What**:
1. Accept `sectionRules` parameter in QA gate (from `designSpec.layout.section_rules[]`)
2. For each rule with `repeats_primary_cta: true`, verify that a CTA element exists in or near that section's content
3. For each rule, verify `required_elements` are present (check for keywords matching element descriptions)
4. Log warnings for missing elements rather than hard-failing (initially)
5. Pass `designSystem.designSpec.layout.section_rules` from index.ts to QA gate calls
**Verify**: Add a section rule that requires a CTA and verify the check logs appropriately

---

## Sprint 3: Template Refactoring (Hardcoded Content Removal)

These require refactoring inline CSS and hardcoded template content. More invasive but high-impact.

### Task 3.1: Refactor Inline Colors to Use CSS Variables
**Gap**: #2 (Critical)
**Files**: `hugo-site/layouts/_default/list.html`, `hugo-site/layouts/_default/single.html`, `hugo-site/layouts/_default/baseof.html`, `hugo-site/static/css/main.css`
**What**:
1. In `list.html`, find all inline `<style>` blocks with hardcoded colors:
   - Replace `#D93A12` with `var(--color-cta-primary)`
   - Replace `#B52D0E` with `var(--color-cta-primary-hover)`
   - Replace `#2D7A3A` with `var(--color-secondary)` (or `var(--color-trust)` for trust elements)
   - Replace `#1A1A1A` with `var(--color-text)`
   - Replace `#5C5C5C` with `var(--color-text-muted)`
   - Replace `#F7F7F5` with `var(--color-surface)`
   - Replace `#E8E8E8` with `var(--color-border)` (add this variable if needed)
   - Replace `#C8290F` with `var(--color-urgency)`
   - Replace `#FFB800` with a `--color-rating` variable
2. Repeat for `single.html` inline styles
3. In `baseof.html`, replace all hardcoded colors in inline styles
4. In `main.css`, align CSS variables with Agent-2's naming or add bridge variables
5. Ensure `generated-theme.css` is loaded AFTER `main.css` so Agent-2 values override defaults
**Verify**: Change Agent-2 colors in DB, rebuild, confirm rendered pages use new colors

### Task 3.2: Add Responsive Breakpoints from Agent-2
**Gap**: #11 (High)
**Files**: `src/agents/agent-3-builder/index.ts`, template CSS sections
**What**:
1. In CSS generation, add breakpoint CSS variables from Agent-2:
   ```css
   :root {
     --bp-mobile: ${breakpoints.mobile}px;
     --bp-phablet: ${breakpoints.phablet}px;
     --bp-tablet: ${breakpoints.tablet}px;
     --bp-laptop: ${breakpoints.laptop}px;
     --bp-desktop: ${breakpoints.desktop}px;
   }
   ```
2. Note: CSS variables can't be used in `@media` queries directly. Instead, generate actual media query blocks in `generated-theme.css`:
   ```css
   @media (min-width: ${breakpoints.phablet}px) { /* phablet overrides */ }
   @media (min-width: ${breakpoints.tablet}px) { /* tablet overrides */ }
   @media (min-width: ${breakpoints.laptop}px) { /* laptop overrides */ }
   @media (min-width: ${breakpoints.desktop}px) { /* desktop overrides */ }
   ```
3. Move inline media queries from templates to reference these generated breakpoints
4. Add the missing phablet (480px) and desktop (1440px) breakpoints with appropriate layout adjustments
**Verify**: Inspect generated CSS for 5 breakpoint media queries; test responsive behavior at each breakpoint

### Task 3.3: Make "How We Work" Section Data-Driven
**Gap**: #19 (Medium)
**Files**: `hugo-site/layouts/_default/list.html`, `src/agents/agent-3-builder/index.ts`
**What**:
1. In `index.ts` frontmatter assembly, add a `process_steps` array:
   ```yaml
   process_steps:
     - icon: "phone-icon"
       title: "Call Us"
       description: "Speak directly with a local pest control specialist..."
     - icon: "match-icon"
       title: "Get Matched"
       description: "We connect you with a vetted, licensed professional..."
     - icon: "service-icon"
       title: "Professional Service"
       description: "Your matched pro arrives and handles the problem..."
   ```
2. Generate the step descriptions using LLM with niche/offer context, or derive from Agent-2 conversion strategy
3. In `list.html`, replace the hardcoded 3-step section with:
   ```html
   {{ range .Params.process_steps }}
   <div class="step-card">
     <div class="step-icon">{{ .icon }}</div>
     <h3>{{ .title }}</h3>
     <p>{{ .description }}</p>
   </div>
   {{ end }}
   ```
4. Keep hardcoded defaults via `{{ $steps := .Params.process_steps | default ... }}`
**Verify**: Build site and confirm process steps render from frontmatter, not hardcoded HTML

### Task 3.4: Make Trust Strategy Placement Data-Driven
**Gap**: #18 (High)
**Files**: `src/agents/agent-3-builder/index.ts`, `hugo-site/layouts/_default/list.html`, `hugo-site/layouts/_default/single.html`
**What**:
1. In `index.ts`, add frontmatter fields for trust placement:
   - `trust_above_fold`: from `designSpec.layout.trust_strategy.above_fold[]`
   - `trust_mid_page`: from `designSpec.layout.trust_strategy.mid_page[]`
   - `trust_near_cta`: from `designSpec.layout.trust_strategy.near_cta[]`
   - `trust_footer`: from `designSpec.layout.trust_strategy.footer[]`
2. In templates, render trust elements at the specified positions:
   - Above fold: in hero section after headline
   - Mid page: before or after the mid-page CTA
   - Near CTA: small trust text directly below CTA buttons
   - Footer: in footer trust section
3. Each position renders its assigned trust signals from the corresponding frontmatter array
**Verify**: Inspect rendered HTML for trust signals at each specified position

### Task 3.5: Utilize Full Headlines Array
**Gap**: #20 (Medium)
**Files**: `src/agents/agent-3-builder/index.ts`
**What**:
1. Currently only `headlines[0]` and `headlines[1]` are resolved via `resolveHeadlineFormula()`
2. Resolve additional headlines and add to frontmatter:
   - `section_headline_1`: from `headlines[2]` — for services section heading
   - `section_headline_2`: from `headlines[3]` — for testimonials section heading
   - `section_headline_3`: from `headlines[4]` — for FAQ section heading
3. In templates, replace hardcoded section headings with these frontmatter fields:
   - "Pest Control Services We Offer" -> `{{ .Params.section_headline_1 | default "Pest Control Services We Offer" }}`
   - "What Our Customers Say" -> `{{ .Params.section_headline_2 | default "What Our Customers Say" }}`
   - "Frequently Asked Questions" -> `{{ .Params.section_headline_3 | default "Frequently Asked Questions" }}`
**Verify**: Confirm section headings in rendered HTML match resolved Agent-2 headline formulas

### Task 3.6: Distribute CTA Microcopy Across Positions
**Gap**: #21 (Medium)
**Files**: `src/agents/agent-3-builder/index.ts`, templates
**What**:
1. Currently `ctaMicrocopy[0]` is the only microcopy passed to frontmatter
2. Add position-specific microcopy:
   - `hero_cta_microcopy`: `ctaMicrocopy[0]`
   - `mid_cta_microcopy`: `ctaMicrocopy[1] || ctaMicrocopy[0]`
   - `sticky_cta_microcopy`: `ctaMicrocopy[2] || ctaMicrocopy[0]`
3. In templates, render different microcopy at each CTA position
4. Keep backward compatibility with existing single `cta_microcopy` field
**Verify**: Check rendered HTML for different microcopy text at each CTA position

---

## Sprint 4: QA Hardening, Cleanup & Polish

### Task 4.1: Add Meta Description Length Validation
**Gap**: #27 (Medium)
**Files**: `src/agents/agent-3-builder/quality-gate.ts`
**What**:
1. Add a check: if `description` (meta description) length is outside 120-160 characters, add a warning
2. If too long (>160), truncate at last word boundary and add "..."
3. If too short (<120), flag for LLM repair
**Verify**: Test with descriptions of various lengths

### Task 4.2: Add Title Tag Format Validation
**Gap**: #28 (Medium)
**Files**: `src/agents/agent-3-builder/quality-gate.ts`
**What**:
1. Add checks:
   - Title length <= 60 characters (warn if over)
   - Title contains city name
   - Title contains target keyword or service type
2. Non-blocking warnings for now, not hard fails
**Verify**: Test with titles missing city name and confirm warning

### Task 4.3: Add Image Alt Text Validation
**Gap**: #29 (Medium)
**Files**: `src/agents/agent-3-builder/quality-gate.ts`, `src/agents/agent-3-builder/index.ts`
**What**:
1. In `index.ts`, when setting `hero_image` frontmatter, also set `hero_image_alt` with a descriptive alt text containing the target keyword and city
2. In QA gate, warn if `hero_image_alt` is missing or doesn't contain the target keyword
3. In templates, add `alt="{{ .Params.hero_image_alt }}"` to hero image tags
**Verify**: Check rendered HTML for alt attributes on hero images

### Task 4.4: Add PAS Structure Validation
**Gap**: #22 (Medium)
**Files**: `src/agents/agent-3-builder/quality-gate.ts`
**What**:
1. For service subpages, add a soft validation check:
   - Content should have identifiable problem statement (first ~25% of content)
   - Content should have agitation/urgency language (middle section)
   - Content should have solution/CTA language (last ~25%)
2. Check for presence of urgency/emotional keywords from the PAS scripts
3. Log as informational metric, not a hard failure
**Verify**: Run against existing service page content and check log output

### Task 4.5: Clean Up Orphaned Partials
**Gap**: #23 (Medium)
**Files**: `hugo-site/layouts/partials/header.html`, `footer.html`, `cta-sticky.html`, `cta-badge.html`, `faq.html`
**What**:
1. Delete orphaned partials that duplicate baseof.html functionality:
   - `header.html` — functionality fully inline in baseof
   - `footer.html` — functionality fully inline in baseof (also has hardcoded "Santa Cruz")
   - `cta-sticky.html` — functionality fully inline in baseof
   - `cta-badge.html` — not used anywhere
2. For `faq.html`: either delete it (FAQ rendering is inline in templates) or fix the key from `.Params.faq` to `.Params.faqs` and include it in templates (preferred if it also generates FAQPage schema)
3. For `schema-jsonld.html`: keep but update — fix hardcoded values (4.8 -> config value, 127 -> config value), integrate into baseof or delete if schema is now handled via frontmatter
**Verify**: Hugo build still succeeds after partial deletion; no missing partial errors

### Task 4.6: Fix Footer Trust Icon Rating Inconsistency
**Gap**: #39 (Low)
**Files**: `hugo-site/layouts/_default/baseof.html`
**What**:
1. Find the hardcoded "5.0" in footer trust icons
2. Replace with `{{ .Site.Params.review_rating | default "5.0" }}`
**Verify**: Check footer renders the config's review_rating value

### Task 4.7: Fix Recording Badge Double Display
**Gap**: #35 (Low)
**Files**: `hugo-site/layouts/_default/baseof.html`
**What**:
1. On mobile, both sticky bar and header show "Calls may be recorded" simultaneously
2. Add `display: none` to the header recording badge when sticky bar is visible (below 768px)
3. Or vice versa — hide the sticky bar's recording text above 768px (it already hides the entire sticky bar at 1024px)
**Verify**: Test at mobile viewport width and confirm only one recording disclosure visible

### Task 4.8: Add Missing License Number to Config
**Gap**: #36 (Low)
**Files**: `hugo-site/config.toml`
**What**:
1. Add `license_number = ""` to `[params]` section
2. In templates, add a guard: `{{ if and .Site.Params.has_license .Site.Params.license_number }}`
**Verify**: Set `has_license = true` and verify license badge renders correctly (or hides if no number)

### Task 4.9: Align Default Guarantees Between Templates
**Gap**: #31, #34 (Medium/Low)
**Files**: `hugo-site/layouts/_default/single.html`
**What**:
1. `list.html` has hardcoded fallback guarantees if none in frontmatter; `single.html` does not
2. Add the same fallback guarantees to `single.html`:
   ```html
   {{ $guarantees := .Params.guarantees | default (slice "Professional treatment with proven methods" "Qualified local technician network" "Transparent pricing with no surprises" "Pet and child-safe treatment options" "100% satisfaction assurance on all service") }}
   ```
3. Or better: once Sprint 2 Task 2.3 is done, guarantees will always be in frontmatter from Agent-2, making hardcoded defaults unnecessary
**Verify**: Build a service page without explicit guarantees and confirm defaults render

### Task 4.10: Add Form-Language Detection to QA
**Gap**: #38 (Low)
**Files**: `src/agents/agent-3-builder/quality-gate.ts`
**What**:
1. Add a banned-patterns check for form-related language:
   - "fill out", "submit your", "complete the form", "request a quote online", "web form"
2. This enforces `conversion_strategy.no_forms: true` in generated content
3. Add to the banned_phrases auto-repair class
**Verify**: Inject "fill out the form" into test content and confirm QA catches it

### Task 4.11: Use Region Overrides in Seasonal Research
**Gap**: #37 (Low)
**Files**: `src/agents/agent-3-builder/index.ts`
**What**:
1. Find `summarizeSeasonalResearch()` function (~lines 1245-1272)
2. Currently ignores `region_overrides` on seasonal months
3. Accept a `region` parameter (state or region name)
4. If a month has `region_overrides` matching the current city's state/region, append the override notes to the seasonal summary
**Verify**: Add a region override to test seasonal data and confirm it appears in the summary

### Task 4.12: Expand Vertical Angles for More Pest Types
**Gap**: #30 (Medium)
**Files**: `src/shared/schemas/copy-frameworks.ts`, `src/agents/agent-3-builder/index.ts`
**What**:
1. In `copy-frameworks.ts`, expand `vertical_angles` schema to include optional additional pest categories:
   - `ants`: z.string().optional()
   - `spiders`: z.string().optional()
   - `cockroaches`: z.string().optional()
   - `mosquitoes`: z.string().optional()
2. In `index.ts`, improve the pest-type matching logic to check for these additional categories before falling back to `general_pest`
3. Update the Agent-2 prompt to request these additional angles when the vertical is pest-control
**Verify**: Generate a service page for "ant control" and confirm it gets the ant-specific angle instead of generic

---

## Deferred / Future Considerations

These items were identified but are architectural changes better suited for a dedicated sprint:

- **Gap #9: Section order enforcement** — Requires either dynamic template rendering (Hugo `partial` selection per section) or post-build HTML reordering. Complex architectural decision needed.
- **Gap #12: Component mobile_behavior implementation** — Requires mapping arbitrary behavior strings to CSS rules. Needs a mapping specification first.
- **Gap #32: Supported archetypes routing** — Different page archetypes per service type. Needs product decision on which archetypes to use where.
- **Gap #25: Competitor analysis downstream usage** — Could enrich LLM prompts for differentiation, but not a conversion blocker.

---

## Verification Protocol

After completing each sprint, run the following checks:

1. **Build test**: `cd hugo-site && hugo --gc --minify` — must succeed with no errors
2. **Content QA**: Run Agent-3 QA gates on at least 1 hub page and 1 service subpage
3. **Visual inspection**: Open rendered HTML in browser, check:
   - CTA text is dynamic (not hardcoded)
   - Trust signals match Agent-2 data
   - Colors match Agent-2 palette
   - Schema markup present in page source
   - Seasonal banner visible
   - Phone number appears 3+ times
   - Compliance disclosures present
   - Footer navigation populated
4. **Regression check**: Existing pages still render correctly with fallback defaults

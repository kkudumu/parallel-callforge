# Pipeline Conversion Gap Audit Prompt

You are a senior systems analyst performing a conversion gap audit on a multi-agent content pipeline. The pipeline has three stages:

1. **Agent-2 (Design Research)** → Produces niche-level research stored in 5 DB tables:
   - `design_specs`: archetype, layout (section_order, section_rules, conversion_strategy, trust_strategy, content_rules), components (name, type, purpose, mobile_behavior, required), colors (10 named colors), typography (heading/body fonts, sizes), responsive_breakpoints
   - `copy_frameworks`: headlines[], ctas[], cta_microcopy[], trust_signals[], guarantees[], reading_level{target_grade_min, target_grade_max, tone, banned_phrases[]}, vertical_angles{general_pest, termites, bed_bugs, wildlife_rodents}, faq_templates[{question, answer_template}], pas_scripts[{problem, agitate, solve}]
   - `schema_templates`: jsonld_templates (LocalBusiness, FAQPage, Service, AggregateRating)
   - `seasonal_calendars`: months[{month, name, primary_pests[], content_topics[], messaging_priority, seasonal_keywords[]}]
   - `competitor_analyses`: analysis object (internal use only)

2. **Agent-3 (Site Builder)** → Loads Agent-2 data into a `DesignSystemContext`, generates LLM content, assembles YAML frontmatter, writes Hugo content files, generates CSS theme, builds and deploys.

3. **Hugo Templates** → Render pages from frontmatter fields: list.html (city hubs), single.html (service subpages), baseof.html (base layout), partials (header, footer, sticky CTA, FAQ, schema-jsonld).

The business model is **pay-per-call** — every page exists to generate phone calls. No web forms. Phone number must be prominent, clickable, and repeated.

---

## YOUR TASK

Audit the ENTIRE pipeline for conversion-impacting gaps. For each gap found, classify it:

### Gap Categories

**A. Data Production → Loading Gaps**
Agent-2 produces data that Agent-3 never queries or ignores after loading.

**B. Loading → Frontmatter Gaps**
Agent-3 loads data into DesignSystemContext but never passes it to page frontmatter or uses it in CSS/template generation.

**C. Frontmatter → Template Gaps**
Frontmatter fields exist but templates don't render them, or render them incompletely.

**D. Hardcoded Template Content**
Template HTML contains hardcoded text, colors, sizes, or copy that should be driven by Agent-2 design research.

**E. Prompt → Content Gaps**
The agent2Summary passed to the LLM for content generation omits Agent-2 data that would improve output quality (e.g., banned phrases list not enforced, content_rules not referenced).

**F. Schema/Structured Data Gaps**
JSON-LD markup is incomplete, uses wrong types, or omits fields that Agent-2's schema templates provide.

**G. Mobile/UX Gaps**
Agent-2's component mobile_behavior specs, responsive_breakpoints, and design patterns not implemented in CSS or templates.

**H. Seasonal Content Gaps**
Seasonal calendar data loaded but not surfaced in templates, not used for dynamic content scheduling, or not reflected in schema markup.

**I. Compliance/Legal Gaps**
Missing disclosures, consent language, or regulatory requirements for pay-per-call/lead-gen sites (TCPA, state licensing disclaimers, call recording consent).

**J. Cross-Page Consistency Gaps**
Data that should be consistent across hub and subpages but is assembled differently, or homepage vs inner pages having different data availability.

**K. Quality Gate Gaps**
Checks that Agent-3's QA gates should perform but don't (e.g., verifying phone number appears N times, checking reading level, validating no banned phrases in output).

---

## AUDIT CHECKLIST

For each item below, determine: Is this data (a) produced by Agent-2, (b) loaded by Agent-3, (c) passed to frontmatter or CSS, (d) rendered by templates? Flag any break in the chain.

### Copy Framework Fields
1. `headlines[]` — Are ALL headline formulas available? Are they resolved with placeholders? Used for H1, H2, subheadlines, mid-page headings?
2. `ctas[]` — Are ALL CTA variants used? Is there CTA rotation or A/B testing support?
3. `cta_microcopy[]` — Used beneath ALL call buttons (hero, mid-page, sticky, footer)?
4. `trust_signals[]` — Rendered in trust bar? Near CTAs? In schema markup?
5. `guarantees[]` — Rendered in dedicated section? Mentioned in content body? In schema?
6. `reading_level.banned_phrases[]` — Enforced in QA gate? Passed to LLM prompt? Post-generation validation?
7. `reading_level.tone` — Passed to LLM prompt? Validated in output?
8. `vertical_angles` — Pest-specific angles used in subpage content? Matched to correct pest type?
9. `faq_templates[]` — All templates used? Placeholders resolved? Schema markup generated?
10. `pas_scripts[]` — Full problem/agitate/solve used in prompts? Validated in output?

### Design Spec Fields
11. `layout.section_order[]` — Does template section order match Agent-2's recommended order?
12. `layout.section_rules[]` — Are section-specific rules (word counts, element counts) enforced?
13. `layout.conversion_strategy` — phone_mentions_min enforced? no_forms validated? CTA placement rules followed?
14. `layout.trust_strategy` — above_fold, mid_page, near_cta placements match template positions?
15. `layout.content_rules` — Word count ranges enforced? Heading density rules followed?
16. `components[]` — Required components all present in templates? Mobile behaviors implemented?
17. `colors` — All 10 named colors used in CSS theme? CTA hover color applied? Urgency color used?
18. `typography` — Font sizes for desktop AND mobile applied? CTA font size used?
19. `responsive_breakpoints` — All 5 breakpoints (mobile, phablet, tablet, laptop, desktop) in CSS?

### Schema Templates
20. `jsonld_templates` — All 4 schema types (LocalBusiness, FAQPage, Service, AggregateRating) generated per page?
21. Schema placeholders resolved with actual page data?
22. AggregateRating schema only rendered when reviews are visible on page (Google requirement)?

### Seasonal Calendar
23. Seasonal pest data surfaced in page content or metadata?
24. Content topics from current month reflected in homepage or hub pages?
25. Messaging priority (prevention vs treatment vs emergency) affects page tone?

### Compliance
26. TCPA consent language present near all phone CTAs?
27. Call recording disclosure on every page?
28. State-specific licensing disclaimers where required?
29. "Do Not Sell" / CCPA compliance page linked?
30. Referral/lead-gen disclosure visible (not just footer)?

### Cross-Page
31. Homepage uses same design system as inner pages?
32. All pages have consistent header/footer/sticky bar?
33. Service subpage links from hub page are all valid?
34. Nearby cities links all resolve to real pages?

### Quality Gates
35. Phone number count validation (minimum per page)?
36. Reading level score validation on generated content?
37. Banned phrase detection in generated content?
38. Image alt text present and keyword-relevant?
39. Meta description length validation (150-160 chars)?
40. Title tag format validation?

---

## OUTPUT FORMAT

For each gap found:

```
### Gap [number]: [Short title]
- **Category**: [A-K]
- **Severity**: Critical (blocks conversions) | High (degrades conversions) | Medium (missed optimization) | Low (polish)
- **Data Source**: [Which Agent-2 field/table]
- **Current State**: [What happens now]
- **Expected State**: [What should happen]
- **Files Affected**: [List of files that need changes]
- **Fix Complexity**: Simple (1 file, <20 lines) | Medium (2-3 files, <100 lines) | Complex (4+ files or architectural change)
```

Prioritize by: Critical > High > Medium > Low, then by fix complexity (simple first).

---

## FILES TO ANALYZE

Provide all of these files to the auditor:

1. `src/agents/agent-2-design/index.ts` — Agent-2 pipeline
2. `src/shared/schemas/design-specs.ts` — DesignSpec schema
3. `src/shared/schemas/copy-frameworks.ts` — CopyFramework schema
4. `src/agents/agent-3-builder/index.ts` — Agent-3 pipeline (LARGE — focus on DesignSystemContext interface, applyDesignSystem(), frontmatter assembly sections, agent2Summary construction, QA gates)
5. `src/agents/agent-3-builder/hugo-manager.ts` — Hugo file management
6. `src/verticals/pest-control/strategy.ts` — Vertical-specific prompts
7. `hugo-site/layouts/_default/baseof.html` — Base template
8. `hugo-site/layouts/_default/list.html` — City hub template
9. `hugo-site/layouts/_default/single.html` — Service subpage template
10. `hugo-site/layouts/partials/*.html` — All partials
11. `hugo-site/static/css/main.css` — Base CSS
12. `hugo-site/config.toml` — Site config
13. Any PRD, requirements, or spec documents in the repo

---

## LIKELY REMAINING GAPS (Pre-Audit Hypotheses)

Based on prior analysis, these are the most probable remaining gaps:

- **`banned_phrases[]`** — Agent-2 produces a list of AI-sounding phrases to avoid, but Agent-3 never validates generated content against it (QA gate gap)
- **`layout.section_order`** — Agent-2 recommends a specific section order but templates use a hardcoded order
- **`layout.content_rules`** — Word count min/max rules exist but aren't enforced in QA gates
- **`components[].mobile_behavior`** — Agent-2 specifies mobile behaviors per component that aren't in CSS
- **`responsive_breakpoints`** — Agent-2 produces 5 breakpoints but CSS only uses 1 (`900px`)
- **`colors.cta_primary_hover`** — Hover color exists in design spec but isn't in generated CSS
- **Seasonal calendar in templates** — Loaded and used in prompts but never rendered as visible content (e.g., "Spring termite season" banner)
- **AggregateRating schema** — Schema template exists but `review_rating`/`review_count` may not flow into JSON-LD properly

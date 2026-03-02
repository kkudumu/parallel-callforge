# Agent 2 Playbook Gap List And Implementation Plan

## Goal

Upgrade Agent 2 so it can produce a pest-control landing page playbook that is:

- Phone-first
- Pay-per-call compliant
- No-form for users
- Centered on a single repeated call CTA
- Rich enough for Agent 3 to build consistent pages without collapsing the strategy into generic layout data

## Current Gaps

1. Agent 2 stores only one top-level archetype string.
   The pest-control playbook depends on multiple archetypes with different intent profiles. The current contract cannot preserve that decision system.

2. Design output is too loose.
   `layout`, `components`, and `colors` are mostly unconstrained blobs. They validate JSON shape, not conversion strategy.

3. Copy output is too shallow.
   Agent 2 currently stores headlines, CTAs, trust signals, FAQs, and PAS only. It does not persist reading-level targets, CTA microcopy, guarantee frameworks, or vertical-specific emotional angles.

4. Competitor analysis is ephemeral.
   It is generated and then discarded. That makes the design system hard to audit and impossible to compare over time.

5. Prompts are generic local-service prompts.
   They do not hard-code the rank-and-rent pest-control rules we actually want: mobile sticky call CTA, repeated phone-only CTA, trust placement hierarchy, no forms, short conversion-focused sections, and pest-specific trust logic.

6. Agent 3 only consumes a tiny slice of Agent 2 output.
   It mostly uses colors, fonts, first CTA strings, and a few trust bullets. The richer design intent never reaches the templates.

7. Existing generated templates in `hugo-site` still show quote forms.
   That conflicts with the pay-per-call operating model.

## Design Decisions For This Upgrade

1. Keep the current database tables and columns intact.
   We will encode richer playbook data inside existing JSONB columns so we do not need a migration to get immediate value.

2. Preserve the existing `archetype` string.
   It remains the selected primary archetype for the niche, while the full archetype catalog will be stored under structured `layout.playbook`.

3. Make phone-only conversion explicit.
   All prompts, schemas, and template fallbacks will enforce:
   - no user forms
   - primary CTA is a phone call
   - repeated call CTA in header, hero, mid-page, sticky footer, and final CTA

4. Increase structure without overfitting.
   We will add required nested objects for conversion strategy, content rules, trust placement, CTA repetition, and copy constraints, but keep enough flexibility for future niches.

## Step-By-Step Coding Tasks

1. Strengthen the design spec schema.
   - Replace loose `layout` shape with a structured object.
   - Add `layout.playbook` metadata for archetype catalog, section rules, CTA repetition, trust placement, and content targets.
   - Keep `components`, `colors`, `typography`, and `responsive_breakpoints` so Agent 3 remains compatible.

2. Strengthen the copy framework schema.
   - Add persisted `cta_microcopy`.
   - Add `guarantees`.
   - Add `reading_level`.
   - Add `vertical_angles` for general pest, termites, bed bugs, and wildlife/rodents.

3. Rewrite Agent 2 prompts around the playbook.
   - Make pest control the explicit reference pattern.
   - Require five archetypes in the playbook, even if one is selected as primary.
   - Force phone-first, no-form output.
   - Require single repeated call CTA, trust hierarchy, and mobile sticky call CTA.
   - Require reading-level, guarantee, and pest-specific emotional framing.

4. Update Agent 2 persistence.
   - Continue storing JSON in the existing JSONB columns.
   - Persist the richer nested structures under `design_specs.layout` and `copy_frameworks` columns.

5. Update Agent 3 normalization.
   - Safely parse the richer playbook fields.
   - Resolve primary CTA, CTA microcopy, trust placement, and content targets from Agent 2 output.

6. Update Agent 3 templates.
   - Keep templates phone-only.
   - Remove any fallback language that implies form submission.
   - Repeat the call CTA in multiple sections.
   - Render doubt-remover microcopy beneath call CTAs.

7. Align the checked-in Hugo example templates.
   - Remove hero and service forms from the committed sample templates.
   - Replace quote buttons with call actions.
   - Keep schema and legal disclosures intact.

8. Update schema tests.
   - Replace the minimal sample payloads with payloads that match the new stricter contract.

9. Run targeted tests.
   - Validate the schema tests.
   - Confirm TypeScript compiles for the touched files.

## Expected Outcome

After this pass:

- Agent 2 will encode a real pest-control conversion playbook instead of generic design notes.
- Agent 3 will consume more of that strategy directly.
- The repository’s sample templates will stop contradicting the pay-per-call model.
- The system will be materially closer to the playbook while respecting the business constraint that the only primary conversion action is a phone call.

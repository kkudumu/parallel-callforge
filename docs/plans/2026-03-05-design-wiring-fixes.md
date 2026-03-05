# Design Wiring Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two remaining gaps where Agent 2's research doesn't reach the rendered Hugo output: stale on-disk CSS variables in baseof.html, and section_order never being passed to content or template prompts.

**Architecture:** Two targeted edits — (1) update the on-disk `baseof.html` to drop its hardcoded `:root {}` block and use the CSS variable names that `generated-theme.css` actually defines, (2) fix the `agent2Summary` in both hub and subpage prompts to pass the real `section_order` array instead of JS object keys, and add an explicit instruction to `HUGO_TEMPLATE_PROMPT` to respect that order.

**Tech Stack:** Hugo HTML templates, TypeScript (agent-3-builder)

---

### Task 1: Fix stale baseof.html — remove hardcoded :root block and rename CSS variables

The on-disk `hugo-site/layouts/_default/baseof.html` was written by an older pipeline run. It has its own `:root {}` block defining CSS variables with short names (`--primary`, `--text`, `--trust`, etc.) that don't match what `generated-theme.css` defines (`--color-primary`, `--color-text`, `--color-trust`, etc.). The theme file is also never linked.

**Files:**
- Modify: `hugo-site/layouts/_default/baseof.html`

**Step 1: Add the stylesheet link**

Find this block near the top of `<head>`:
```html
    <meta name="description" content="{{ .Description }}">

    <style>
```

Replace with:
```html
    <meta name="description" content="{{ .Description }}">
    <link rel="stylesheet" href="/css/generated-theme.css">

    <style>
```

**Step 2: Remove the :root block**

Find and remove this entire block (lines ~12–23):
```css
        :root {
            --text: #1F2933;
            --trust: #2F7A3E;
            --primary: #123524;
            --surface: #FFFDF8;
            --urgency: #B42318;
            --secondary: #E7D8B1;
            --background: #F7F4EC;
            --text-muted: #5B6870;
            --cta-primary: #D95F0E;
            --cta-primary-hover: #B94F0A;
        }
```

Replace with nothing (delete it entirely). `generated-theme.css` now provides all of these.

**Step 3: Rename all CSS variable references throughout the file**

Use replace_all for each of these renames in `baseof.html`:

| Find | Replace |
|------|---------|
| `var(--text)` | `var(--color-text)` |
| `var(--trust)` | `var(--color-trust)` |
| `var(--primary)` | `var(--color-primary)` |
| `var(--surface)` | `var(--color-surface)` |
| `var(--urgency)` | `var(--color-urgency)` |
| `var(--secondary)` | `var(--color-secondary)` |
| `var(--background)` | `var(--color-background)` |
| `var(--text-muted)` | `var(--color-text-muted)` |
| `var(--cta-primary-hover)` | `var(--color-cta-primary-hover)` |
| `var(--cta-primary)` | `var(--color-cta-primary)` |

**Important:** rename `--cta-primary-hover` BEFORE `--cta-primary` to avoid partial matches.

**Step 4: Verify no old variable names remain**

```bash
grep -n "var(--text)\|var(--trust)\|var(--primary)\|var(--surface)\|var(--urgency)\|var(--secondary)\|var(--background)\|var(--text-muted)\|var(--cta-primary)" hugo-site/layouts/_default/baseof.html
```

Expected: no output (zero matches)

**Step 5: Verify the stylesheet link exists**

```bash
grep "generated-theme.css" hugo-site/layouts/_default/baseof.html
```

Expected: one match — the `<link>` tag

**Step 6: Build Hugo to verify no template errors**

```bash
cd /root/general-projects/parallel-callforge/hugo-site && hugo --minify 2>&1 | tail -20
```

Expected: `Total in X ms` with no ERROR lines

**Step 7: Commit**

```bash
git add hugo-site/layouts/_default/baseof.html
git commit -m "fix(hugo): wire baseof.html to generated-theme.css, rename CSS variables to --color-* convention"
```

---

### Task 2: Wire section_order to hub and subpage content prompts

**The bug:** Line 2328 in `index.ts` passes:
```typescript
"- Layout sequence: " + Object.keys(designSystem.designSpec.layout).join(", "),
```
This gives the LLM a string like `"primary_archetype, supported_archetypes, section_order, section_rules, conversion_strategy, trust_strategy, content_rules"` — the JS object property names, not the actual researched section order. The subpage `agent2Summary` doesn't include section order at all.

**Files:**
- Modify: `src/agents/agent-3-builder/index.ts` lines ~2328 and ~2676–2685

**Step 1: Fix the hub agent2Summary (line ~2328)**

Find:
```typescript
              "- Layout sequence: " + Object.keys(designSystem.designSpec.layout).join(", "),
```

Replace with:
```typescript
              "- Section order: " + (designSystem.designSpec.layout.section_order ?? []).join(" → "),
```

**Step 2: Add section_order to the subpage agent2Summary (line ~2683–2684)**

Find this block inside the subpage `agent2Summary` IIFE (the `return [` block around lines 2675–2685):
```typescript
                  "- Trust placement hierarchy: Above fold = " + (designSystem.designSpec.layout.trust_strategy?.above_fold ?? []).join(", ") + "; Mid-page = " + (designSystem.designSpec.layout.trust_strategy?.mid_page ?? []).join(", ") + "; Near CTA = " + (designSystem.designSpec.layout.trust_strategy?.near_cta ?? []).join(", "),
                  "- Conversion strategy: Phone mentions minimum " + (designSystem.designSpec.layout.conversion_strategy?.phone_mentions_min ?? 4) + ", no forms allowed",
                ].join("\n");
```

Replace with:
```typescript
                  "- Section order: " + (designSystem.designSpec.layout.section_order ?? []).join(" → "),
                  "- Trust placement hierarchy: Above fold = " + (designSystem.designSpec.layout.trust_strategy?.above_fold ?? []).join(", ") + "; Mid-page = " + (designSystem.designSpec.layout.trust_strategy?.mid_page ?? []).join(", ") + "; Near CTA = " + (designSystem.designSpec.layout.trust_strategy?.near_cta ?? []).join(", "),
                  "- Conversion strategy: Phone mentions minimum " + (designSystem.designSpec.layout.conversion_strategy?.phone_mentions_min ?? 4) + ", no forms allowed",
                ].join("\n");
```

**Step 3: Verify TypeScript compiles**

```bash
cd /root/general-projects/parallel-callforge && npx tsc --noEmit
```

Expected: no errors

**Step 4: Commit**

```bash
git add src/agents/agent-3-builder/index.ts
git commit -m "fix(agent-3): pass actual section_order to content prompts instead of JS object keys"
```

---

### Task 3: Add section_order instruction to HUGO_TEMPLATE_PROMPT

The design spec JSON (including `layout.section_order`) is already passed to the template generation prompt, but the prompt says nothing about using it. The LLM picks section order arbitrarily.

**Files:**
- Modify: `src/agents/agent-3-builder/prompts.ts`

**Step 1: Add the section_order instruction**

In `HUGO_TEMPLATE_PROMPT`, find the `## OUTPUT` section:
```
## OUTPUT

Generate three templates:
1. baseof — Full page shell: ...
2. city_hub — Defines {{ define "main" }}: hero section, services grid, local trust signals, testimonials, CTA
3. service_subpage — Defines {{ define "main" }}: identification section, treatment section, mid-page CTA, prevention tips, FAQ accordion, service areas, related pests, final CTA
```

Replace with:
```
## OUTPUT

Generate three templates:
1. baseof — Full page shell: <html>, <head> with meta/title/stylesheet link, sticky mobile call bar, header with phone, <main> block, footer with NAP/links, structured-data block
2. city_hub — Defines {{ define "main" }}: arrange sections using the design spec's `layout.section_order` array as the sequence. Map section names to content blocks (e.g. "hero" → hero section, "trust" → trust bar, "services" → services grid, "faq" → FAQ accordion, "cta" → CTA block).
3. service_subpage — Defines {{ define "main" }}: arrange sections using `layout.section_order` where applicable. Standard subpage sections: identification, treatment, mid-page CTA, prevention tips, FAQ accordion, service areas, related pests, final CTA.
```

**Step 2: Verify TypeScript compiles**

```bash
cd /root/general-projects/parallel-callforge && npx tsc --noEmit
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/agents/agent-3-builder/prompts.ts
git commit -m "fix(agent-3): instruct HUGO_TEMPLATE_PROMPT to use design spec section_order for template layout"
```

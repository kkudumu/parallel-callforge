# Design Pipeline CSS Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three bugs that cause the generated Hugo sites to look nothing like the researched design: dead CSS link, CSS variable naming mismatch, and an underqualified model generating templates.

**Architecture:** Three targeted changes — upgrade the template generation model from Haiku to Sonnet, rewrite the HUGO_TEMPLATE_PROMPT to specify exact CSS variable names and enforce the stylesheet link, and add a structural repair in template-review.ts to inject the link if the LLM still misses it. Also tie the template cache fingerprint to the prompt text so cache auto-busts on prompt changes.

**Tech Stack:** TypeScript, Hugo, CSS custom properties

---

### Task 1: Upgrade template generation from Haiku to Sonnet

Template generation is a creative, multi-hundred-line task. Haiku is the wrong model for it.

**Files:**
- Modify: `src/agents/agent-3-builder/index.ts` (around line 1509)

**Step 1: Change the model**

Find this block (around line 1500–1512):

```typescript
const generateHugoTemplatesFromLlm = async () => {
    const hugoPrompt = HUGO_TEMPLATE_PROMPT.replace("{design_spec}", designSpecSummary);
    ...
    generatedTemplates = await llm.call({
        prompt: hugoPrompt,
        schema: HugoTemplateResponseSchema,
        model: "haiku",
        timeoutMs: AGENT3_TEMPLATE_TIMEOUT_MS,
        ...
    });
```

Change `model: "haiku"` to `model: "sonnet"`.

**Step 2: Also include the prompt in the cache fingerprint**

Find the fingerprint line (around line 1486):

```typescript
const designFingerprint = computeCacheFingerprint(designSpecSummary);
```

Change to:

```typescript
const designFingerprint = computeCacheFingerprint(designSpecSummary + HUGO_TEMPLATE_PROMPT);
```

This ensures any prompt change automatically invalidates the old cached templates.

**Step 3: Verify TypeScript compiles**

```bash
cd /root/general-projects/parallel-callforge
npx tsc --noEmit
```

Expected: no errors

**Step 4: Commit**

```bash
git add src/agents/agent-3-builder/index.ts
git commit -m "fix(agent-3): upgrade template generation model from haiku to sonnet, tie cache fingerprint to prompt"
```

---

### Task 2: Rewrite HUGO_TEMPLATE_PROMPT to enforce CSS variables and stylesheet link

The prompt currently lets the LLM freely invent CSS variables. It must instead use the exact variable names written by the CSS generator in index.ts, and must link to `/css/generated-theme.css`.

**Files:**
- Modify: `src/agents/agent-3-builder/prompts.ts`

**Step 1: Replace HUGO_TEMPLATE_PROMPT**

Replace the existing `HUGO_TEMPLATE_PROMPT` export with:

```typescript
export const HUGO_TEMPLATE_PROMPT = `You are a Hugo static site generator expert and professional web designer.

Given this design specification, generate three production-quality Hugo HTML templates that look polished, trustworthy, and conversion-optimized:
{design_spec}

## CRITICAL CSS RULES — follow these exactly

The pipeline writes a CSS theme file at /css/generated-theme.css that defines all design tokens. Your baseof.html MUST link to it in the <head>:

    <link rel="stylesheet" href="/css/generated-theme.css">

The theme file defines these CSS custom properties — use ONLY these names in your templates (never invent alternatives):

    --color-primary           (brand primary, use for headings, borders)
    --color-primary-dark      (hover states on primary)
    --color-secondary         (warm accent, subheadings, badges)
    --color-bg-alt            (light warm background for callout blocks)
    --color-success           (green trust color)
    --color-cta-primary       (main CTA button background)
    --color-cta-primary-hover (main CTA hover state)
    --color-urgency           (red for urgency/emergency messaging)
    --color-text              (body text)
    --color-text-muted        (secondary/caption text)
    --color-trust             (trust badge/icon color)
    --color-background        (page background)
    --color-surface           (card/section background)
    --color-border            (dividers, borders)
    --font-heading            (heading font stack)
    --font-body               (body font stack)
    --font-size-cta           (CTA button font size)

Do NOT add <style> blocks that redefine or shadow these variables. You may write component CSS using var(--color-primary) etc.

## OUTPUT

Generate three templates:
1. baseof.html — Full page shell: <html>, <head> with meta/title/stylesheet link, sticky mobile call bar, header with phone, <main> block, footer with NAP/links, structured-data block
2. city_hub — Defines {{ define "main" }}: hero section, services grid, local trust signals, testimonials, CTA
3. service_subpage — Defines {{ define "main" }}: identification section, treatment section, mid-page CTA, prevention tips, FAQ accordion, service areas, related pests, final CTA

## DESIGN REQUIREMENTS
- Mobile-first CSS (min-width breakpoints matching the spec's responsive_breakpoints)
- Sticky click-to-call footer bar on mobile (position: fixed; bottom: 0)
- Phone number visible above the fold
- CTA buttons: min-height 60px, full-width on mobile, high-contrast using var(--color-cta-primary)
- No user-facing forms — call-only CTAs throughout
- FAQ uses <details>/<summary> accordion — no JavaScript required
- Professional, clean layout — avoid emoji overload, trust comes from typography and structure

## HUGO TEMPLATE RULES
- NEVER use {{ range first N .Params.someField }} — this crashes when the field is nil
- Instead always guard with: {{ if .Params.someField }}{{ range first N .Params.someField }}...{{ end }}{{ end }}
- Child templates (city_hub, service_subpage) define blocks only — no <html> or <head> tags
- baseof.html is a full HTML document with {{ block "main" . }}{{ end }} in the body

Output ONLY valid JSON matching the provided schema.`;
```

**Step 2: Verify TypeScript compiles**

```bash
cd /root/general-projects/parallel-callforge
npx tsc --noEmit
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/agents/agent-3-builder/prompts.ts
git commit -m "fix(agent-3): rewrite HUGO_TEMPLATE_PROMPT to enforce CSS variable names and stylesheet link"
```

---

### Task 3: Add stylesheet link enforcement to template-review.ts

Even with the prompt fix, the LLM might still omit the link on some runs. Add a deterministic repair step.

**Files:**
- Modify: `src/agents/agent-3-builder/template-review.ts`

**Step 1: Add the repair function**

After the `fixPartialNames` function (around line 187), add:

```typescript
const THEME_STYLESHEET_LINK = '<link rel="stylesheet" href="/css/generated-theme.css">';

function ensureStylesheetLink(source: string): { result: string; fixed: boolean } {
  if (source.includes('/css/generated-theme.css')) {
    return { result: source, fixed: false };
  }

  // Inject before </head> if present
  if (/<\/head>/i.test(source)) {
    const result = source.replace(/<\/head>/i, `  ${THEME_STYLESHEET_LINK}\n</head>`);
    return { result, fixed: true };
  }

  // If no </head> tag, inject after the last <meta> or <title> tag
  const lastHeadTagMatch = source.match(/(.*<(?:meta|title)[^>]*>)/is);
  if (lastHeadTagMatch) {
    const insertPos = source.lastIndexOf(lastHeadTagMatch[0]) + lastHeadTagMatch[0].length;
    const result = source.slice(0, insertPos) + `\n  ${THEME_STYLESHEET_LINK}` + source.slice(insertPos);
    return { result, fixed: true };
  }

  return { result: source, fixed: false };
}
```

**Step 2: Call it in reviewGeneratedHugoTemplates**

In the `reviewGeneratedHugoTemplates` function, after the `fixPartialNames` calls and before the normalize calls, add:

```typescript
// Ensure baseof.html links to the generated theme stylesheet
const baseofStyleFixed = ensureStylesheetLink(baseofPartialFixed.result);
if (baseofStyleFixed.fixed) {
  repairsApplied.push("baseof_stylesheet_link_injected");
}
const repairedBaseof = baseofStyleFixed.result;
```

And update the line below (which currently says `const repairedBaseof = baseofPartialFixed.result;`) — remove the old assignment since the new one replaces it.

The other two templates (`repairedCityHub`, `repairedServiceSubpage`) don't need this fix as they are child templates with no `<head>`.

**Step 3: Verify TypeScript compiles**

```bash
cd /root/general-projects/parallel-callforge
npx tsc --noEmit
```

Expected: no errors

**Step 4: Run the template-review tests to verify nothing broke**

```bash
cd /root/general-projects/parallel-callforge
npx vitest run src/agents/agent-3-builder/
```

Expected: all existing tests pass

**Step 5: Commit**

```bash
git add src/agents/agent-3-builder/template-review.ts
git commit -m "fix(template-review): inject generated-theme.css link if LLM omits it"
```

---

### Task 4: Update designdecisions.md

**Files:**
- Modify: `designdecisions.md`

**Step 1: Append a new section**

Add this section at the end of the file:

```markdown
## March 5, 2026: Design Pipeline CSS Fix

Three bugs were discovered that collectively caused the generated Hugo sites to look nothing like the researched design.

### Bug 1: generated-theme.css Was Never Loaded

The pipeline correctly wrote `static/css/generated-theme.css` with the design spec's color and font values. But the LLM-generated `baseof.html` never contained a `<link>` to it.

**Fix:** Two layers of enforcement:
1. `HUGO_TEMPLATE_PROMPT` now explicitly instructs the LLM to include `<link rel="stylesheet" href="/css/generated-theme.css">` in the `<head>`.
2. `template-review.ts` now has a `ensureStylesheetLink` repair that deterministically injects the link if the LLM still misses it.

### Bug 2: CSS Variable Naming Mismatch

`generated-theme.css` defined variables named `--color-primary`, `--color-trust`, etc. The LLM-generated templates used `var(--primary)`, `var(--trust)`, etc. — different names. Even when the stylesheet was loaded, the variables resolved to nothing.

**Fix:** `HUGO_TEMPLATE_PROMPT` now explicitly lists the exact CSS variable names the LLM must use (matching what index.ts writes to generated-theme.css). The LLM is also told not to define its own inline CSS variables that shadow the theme.

### Bug 3: Template Generation Used Haiku

`HUGO_TEMPLATE_PROMPT` was sent to `claude-haiku`, the weakest model. Generating three polished, responsive, CRO-optimized HTML templates from a JSON design spec is a creative, high-complexity task that Haiku cannot execute well.

**Fix:** Changed `model: "haiku"` to `model: "sonnet"` in the `generateHugoTemplatesFromLlm` call in `agent-3-builder/index.ts`.

### Cache Fingerprint Now Includes Prompt

Previously, the template cache fingerprint was computed only from the design spec JSON. This meant prompt changes never busted the cache, so old templates would be reused indefinitely.

**Fix:** The fingerprint is now computed from `designSpecSummary + HUGO_TEMPLATE_PROMPT`. Any prompt change automatically invalidates cached templates.
```

**Step 2: Commit**

```bash
git add designdecisions.md
git commit -m "docs: document design pipeline CSS fix decisions"
```

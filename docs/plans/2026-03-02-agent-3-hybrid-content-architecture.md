# Agent 3 Hybrid Content Architecture

## Goal

Reduce Agent 3 page generation time toward a practical target of `30-60s per page` without turning pages into thin, repetitive boilerplate that risks weak indexing.

The design should:

- preserve strong local variation
- keep compliance deterministic
- reduce prompt size and model wall-clock time
- support bounded parallelism
- degrade gracefully when one provider is slow or times out

## Core Principle

Do not choose between:

- fully deterministic pages with city-name swaps
- fully freeform, giant one-shot LLM page generation

Use a hybrid model instead:

- deterministic page architecture
- LLM-generated, fact-driven variable content blocks

The stable structure should be code. The page substance should still vary meaningfully by city, service, season, and local conditions.

## What Should Be Deterministic

These parts should be assembled in code, not generated from scratch on every page:

- route and slug handling
- frontmatter shape
- schema wrapper structure
- CTA block structure
- disclaimer insertion
- trust module structure
- FAQ rendering layout
- page layout and section ordering rules
- component-level HTML/Hugo partials
- required compliance guardrails

This removes repeated work from the model and makes compliance failures less likely.

## What Should Stay Variable

These parts should be generated from structured local inputs:

- local problem framing
- city-specific pest pressure explanation
- seasonal patterns
- service process narrative
- cost framing
- local geography references
- housing stock / climate context
- FAQ answers with local nuance
- page intro and CTA support copy

This is the content that creates meaningful page differentiation and should remain high-variance.

## Recommended Page Pipeline

### 1. Build a Page Input Packet

Before any model call, Agent 3 should assemble a compact structured packet per page:

- `pageType`: `hub` or `service`
- `city`
- `state`
- `county`
- `targetKeyword`
- `serviceType`
- `allowedPests`
- `blockedTerms`
- `approvedCTA`
- `seasonalSignals`
- `localFacts`
- `trustSignals`
- `routeKey`

This packet should be concise and only include data needed for the specific page.

### 2. Generate a Compact Page Brief

Use a fast model to produce a short structured brief:

- angle / narrative
- 6-10 headings
- local facts to emphasize
- seasonal framing
- FAQ topics
- recommended word-count allocation by section

This brief should be cached and reusable.

### 3. Generate Only Variable Content Blocks

From the brief, generate a small set of prose blocks instead of the entire page HTML:

- intro
- local conditions block
- seasonal block
- treatment / process block
- cost block
- FAQ answers
- CTA support copy

Each block should be plain structured text, not full page markup.

### 4. Assemble the Page Deterministically

Code should merge:

- frontmatter template
- Hugo partials
- stable modules
- generated content blocks

This keeps layout, compliance, and formatting stable while preserving page-level content variance.

### 5. Run a Final Validator

After assembly, run a lightweight validator pass that checks:

- banned phrases
- required disclaimer
- city mention range
- page length range
- required headings present
- no forbidden services/pests
- no missing phone token handling

Only invoke a stronger repair pass if validation fails.

## Parallelism Strategy

The first parallelization target should be page-level, not section-level.

### Preferred

- one worker per page
- bounded concurrency of `2-4` active page jobs
- hub page and service page for a city may run in parallel
- pages across cities may run in parallel

### Avoid as Default

- one worker per section within a page

Section-level splitting increases:

- prompt duplication
- merge complexity
- tone inconsistency
- duplicate facts
- compliance drift

Section chunking should only be used for unusually long pages that cannot be generated reliably as a small number of content blocks.

## Model Role Split

Use multiple models only when they have distinct jobs.

### Fast Draft Model

Use a fast model such as:

- Claude Haiku
- Gemini Flash
- another low-latency structured-output model

Best use:

- page brief generation
- short content block generation
- FAQ generation

### Fallback / Repair Model

Use a stronger but slower model only when needed:

- failed validation repair
- low-quality or malformed draft recovery
- edge-case long-form pages

### Anti-Pattern

Do not ask three different models to each write the same full page and then choose one. That adds cost and coordination but does not solve the core latency issue.

## Why This Can Reach 30-60 Seconds

The current slow path is a large one-shot generation where a single model must:

- plan
- localize
- enforce compliance
- structure the page
- write long-form prose
- package structured output

The hybrid architecture speeds this up by removing most of that work from each individual model call.

Practical latency reduction comes from:

- much smaller prompts
- shorter outputs per call
- cheaper/faster models for the draft path
- deterministic assembly in code
- bounded parallel page workers
- validation instead of full rewrite on the happy path

The `30-60s` target becomes realistic when the model is writing a few targeted blocks, not a full bespoke page document from scratch.

## Variation Without Thin Content

To avoid creating repetitive pages, variation must come from real signals, not random phrasing.

Agent 3 should vary pages using:

- local climate
- neighborhood / geography references
- housing stock differences
- seasonal pest patterns
- service-specific risk explanations
- distinct FAQ topics per city
- different emphasis by city and page type
- variable section depth based on city facts

The system should not rely on generic "sound unique" prompting. It should rely on better local inputs and controlled content variation.

## Suggested Agent 3 Refactor

### Split Agent 3 into Internal Stages

1. `buildPagePacket()`
2. `generatePageBrief()`
3. `generateContentBlocks()`
4. `assemblePage()`
5. `validatePage()`
6. `repairPage()` only on failure

### Add Internal Work Queue

Implement a page queue with bounded concurrency:

- enqueue all selected hub pages
- enqueue all selected service subpages
- process with a worker limit
- preserve deterministic save ordering if needed after generation

### Cache at the Right Layer

Cache:

- page brief
- generated content blocks
- validation results

Do not cache only final pages. Reusable intermediate artifacts make retries much faster.

## Concrete Near-Term Changes

1. Move disclaimer, CTA, trust modules, and schema scaffolding fully into deterministic code.
2. Replace one-shot page prompts with a `brief -> content blocks -> assembly` flow.
3. Add page-level concurrency with a small worker pool.
4. Introduce a fast-model draft path for content blocks.
5. Keep the current slower model only as fallback or repair.
6. Add a validator that can reject pages before save instead of forcing a full regeneration.

## Decision

The preferred architecture is:

- deterministic skeleton
- fact-driven variable content modules
- page-level parallel workers
- fast-model draft generation
- stronger-model repair only on failure

The default architecture should **not** be section-level subagents for every page.

That approach adds coordination cost and quality risk before it solves the real bottleneck.

# Agent 3 Hybrid Content Implementation Plan

## Objective

Refactor Agent 3 from a slow, monolithic page-generation pipeline into a hybrid architecture that:

- preserves meaningful content variation
- improves compliance reliability
- reduces model wall-clock time
- supports bounded page-level parallelism
- moves toward a practical target of `30-60s per page`

This document is an implementation plan only. It does not change current behavior.

## Non-Goals

This refactor should not:

- convert pages into simple city-name swap templates
- default to section-level subagent fan-out for every page
- weaken compliance constraints
- remove the ability to use stronger fallback models when needed
- interrupt the currently running Agent 3 process

## Current Problems

The current Agent 3 design has several bottlenecks:

- each page is generated as a large one-shot prompt
- the model handles planning, writing, compliance, and structure in a single call
- prompts include too much repeated context
- long outputs create high latency and more timeout risk
- the same static blocks are regenerated repeatedly
- page generation is largely serialized

This causes:

- slow per-page runtime
- high variability in completion time
- expensive fallback behavior
- unnecessary model work

## Target Architecture

Agent 3 should be internally split into four content stages and two control stages:

1. `buildPagePacket`
2. `generatePageBrief`
3. `generateContentBlocks`
4. `assemblePage`
5. `validatePage`
6. `repairPage` only if validation fails

The output page should still look custom and locally relevant, but the structure and compliance wrapper should be deterministic.

## Workstreams

### Workstream 1: Extract Deterministic Page Skeleton

Move repeated, stable page pieces out of the LLM path and into code.

#### Scope

- route key generation
- frontmatter scaffolding
- schema wrapper insertion
- disclaimer insertion
- CTA container structure
- trust block structure
- FAQ rendering structure
- Hugo partial usage and layout rules
- phone token insertion rules

#### Deliverables

- reusable assembly helpers for hub pages
- reusable assembly helpers for service subpages
- explicit schema partial helpers
- deterministic compliance wrapper functions

#### Success Criteria

- page shell can be rendered without any model call
- generated text only fills defined content slots
- disclaimer and schema never depend on freeform model output

### Workstream 2: Introduce a Compact Page Packet

Create a structured packet that contains only page-specific inputs.

#### Proposed Fields

- `offerId`
- `vertical`
- `pageType`
- `routeKey`
- `city`
- `state`
- `county`
- `targetKeyword`
- `serviceType`
- `primaryPest`
- `secondaryPests`
- `allowedTrafficConstraints`
- `blockedTerms`
- `requiredDisclaimer`
- `ctaVariants`
- `trustSignals`
- `seasonalSignals`
- `localFacts`
- `wordCountTarget`

#### Deliverables

- `buildPagePacket()` function
- typed schema for packet shape
- normalization rules for missing optional fields

#### Success Criteria

- all page-generation calls accept a packet instead of raw mixed inputs
- prompt size is materially smaller than the current one-shot prompt

### Workstream 3: Add Brief Generation

Generate a short structured page brief before writing page prose.

#### Brief Output Shape

- page angle
- section list
- local facts to emphasize
- seasonal angle
- FAQ themes
- recommended section depth
- banned content reminders

#### Model Strategy

- use a fast model by default
- keep output short and strictly structured
- cache the brief by page key and relevant inputs

#### Deliverables

- `generatePageBrief(packet)`
- brief cache table or cache-key strategy
- structured schema for brief output

#### Success Criteria

- brief generation is significantly faster than a full page call
- repeated retries can reuse the same brief

### Workstream 4: Generate Variable Content Blocks

Replace one giant page-generation call with a few focused content-block calls.

#### Proposed Block Set for Hub Pages

- intro / local framing
- city conditions and pest pressure
- seasonal timing
- process / service method
- trust support copy
- CTA support copy
- FAQ answers

#### Proposed Block Set for Service Pages

- intro / symptom framing
- identification / signs
- local conditions
- treatment options
- cost framing
- prevention
- FAQ answers
- CTA support copy

#### Model Strategy

- use a fast model for default block generation
- generate plain text or structured markdown fragments
- avoid asking the model for full page HTML
- allow two to three block groups per page if needed

#### Deliverables

- `generateContentBlocks(packet, brief)`
- typed schema per page type
- per-block cache keyed by page input packet hash

#### Success Criteria

- content block generation is faster and more stable than one-shot page generation
- blocks are independently retryable

### Workstream 5: Deterministic Assembly

Assemble final pages from:

- stable page skeleton
- generated content blocks
- standard modules

#### Assembly Responsibilities

- inject frontmatter
- render headings in canonical order
- insert CTA blocks
- insert trust module
- render FAQs in standard layout
- append disclaimer
- attach schema payload

#### Deliverables

- `assembleHubPage()`
- `assembleServicePage()`
- shared markdown / Hugo assembly helpers

#### Success Criteria

- final output is renderable without any model participation at assembly time
- pages remain consistent in structure while content varies

### Workstream 6: Validation and Repair

Add explicit validation after assembly and use repair only on failure.

#### Validation Checks

- banned phrase detection
- required disclaimer presence
- city mention count range
- min/max page length
- required heading presence
- forbidden pest / service terms
- unresolved placeholders
- malformed frontmatter

#### Repair Strategy

- first attempt deterministic fixes where possible
- only escalate to model-based repair when needed
- use stronger model only for repair or malformed content recovery

#### Deliverables

- `validatePage(page, packet)`
- structured validation result object
- `repairPage(page, validationResult)` path

#### Success Criteria

- most pages pass on first assembly
- repair path is rare and targeted

### Workstream 7: Add Page-Level Concurrency

Introduce a bounded page worker queue inside Agent 3.

#### Concurrency Model

- enqueue all page jobs for selected cities
- process with configurable concurrency
- start with `2` workers, allow tuning to `3-4`
- support hub and service pages running in parallel

#### Guardrails

- bounded concurrency only
- keep provider rate limits in mind
- keep DB writes safe and deterministic
- preserve clean logging per page job

#### Deliverables

- page job queue
- worker pool with configurable concurrency
- page-specific logging and error aggregation

#### Success Criteria

- wall-clock time improves materially for multi-city runs
- failure in one page does not block all others

### Workstream 8: Model Role Separation

Explicitly assign jobs to model tiers instead of using all models interchangeably.

#### Default Roles

- fast model:
  - brief generation
  - content block generation
  - FAQ generation

- stronger model:
  - repair
  - exceptional long-form cases
  - malformed output recovery

#### Optional Expansion

- add Gemini CLI as an additional fast-model provider if it performs better on short structured tasks

#### Deliverables

- provider routing policy by task type
- timeout policy by task type
- fallback strategy per stage

#### Success Criteria

- provider usage matches task complexity
- expensive slow models are not the default for every page

## Data and Caching Changes

The current system should stop caching only the final page as the main reusable artifact.

New cache layers should include:

- page brief cache
- content block cache
- validation result cache

Final page cache can remain, but intermediate cache layers will make retries and partial rebuilds much faster.

## Logging and Observability

Agent 3 should emit stage-level logs instead of only page-level monolith logs.

### Needed Visibility

- packet build started/completed
- brief generation started/completed
- content block generation started/completed
- assembly started/completed
- validation passed/failed
- repair invoked or skipped
- page save completed

### Why This Matters

- easier ETA estimation
- easier identification of bottlenecks
- clearer fallback diagnostics
- simpler detection of where time is actually spent

## Suggested Rollout Sequence

### Phase 1: Safe Structural Refactor

- introduce packet builder
- introduce deterministic skeleton helpers
- keep current one-shot generation for prose
- keep current single-threaded execution

This reduces risk while separating concerns.

### Phase 2: Brief + Block Generation

- replace one-shot prompts with brief generation
- add content block generation
- add deterministic assembly
- keep concurrency low or disabled at first

This changes the core page architecture.

### Phase 3: Validation + Repair

- add post-assembly validation
- add deterministic fixes
- add selective repair path

This reduces silent compliance drift.

### Phase 4: Bounded Parallelism

- add page worker queue
- enable `2` concurrent page jobs
- tune upward after observing provider behavior

This should produce the largest wall-clock improvement for multi-page runs.

### Phase 5: Provider Optimization

- route brief and blocks to fastest reliable model
- keep stronger fallback for repairs
- optionally evaluate Gemini CLI for short structured stages

This is a tuning phase, not the main architectural change.

## Risks

### Risk 1: Over-Templating

If too much copy is moved into deterministic code, pages may feel repetitive.

Mitigation:

- keep major explanatory blocks variable
- drive content from real local facts
- vary page emphasis by city and service

### Risk 2: Over-Fragmentation

If content is split into too many micro-blocks, coherence will drop.

Mitigation:

- use a small number of substantial blocks
- avoid section-per-call architecture by default

### Risk 3: Parallelism-Induced Provider Contention

Too many simultaneous calls may cause slower responses or more fallbacks.

Mitigation:

- start with low concurrency
- make worker count configurable
- monitor latency before increasing throughput

### Risk 4: More Complex Caching

Additional cache layers introduce invalidation complexity.

Mitigation:

- key caches from normalized packet hashes
- version cache schemas explicitly
- invalidate by stage when prompts or schemas change

## Acceptance Criteria

The refactor should be considered successful when:

- per-page median runtime drops substantially from current levels
- most pages do not require strong-model fallback
- pages remain locally differentiated and useful
- compliance failures are caught before save
- multi-city runs complete faster because of bounded parallelism
- logs clearly show where time is spent

The `30-60s per page` target is an optimization goal, not an initial hard requirement. The first milestone is reducing page latency materially while maintaining quality and control.

## Next Step After Approval

Once approved for implementation, start with:

1. packet builder
2. deterministic skeleton extraction
3. brief schema design
4. content block schema design

Those pieces can be added first without changing the currently running session or forcing an all-at-once rewrite.

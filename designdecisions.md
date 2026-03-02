# Design Decisions

## Purpose

This document captures the current architecture decisions made while stabilizing and extending the pipeline.

The system is no longer treated as a generic "niche" generator with hardcoded pest-control assumptions. It is now evolving toward:

- a vertical orchestration layer
- per-vertical reusable definitions
- per-offer monetization profiles
- checkpointed agent execution

The immediate goal is reliable monetization-aligned site generation. The long-term goal is onboarding new verticals by adding a new vertical definition and then reusing it across multiple offer profiles.

## Core Model

There are now three layers of decision-making:

1. Vertical definition
2. Offer profile
3. Runtime execution state

### 1. Vertical Definition

A vertical definition is the reusable playbook for a niche such as:

- `pest-control`
- `hvac`
- `roofing`

It defines the default rules for that vertical:

- core services
- excluded services
- default service scope
- default banned phrases
- keyword guidance
- design guidance

It is stored in:

- DB table: `vertical_profiles`
- migration: [src/shared/db/migrations/011-vertical-profiles.sql](/root/general-projects/parallel-callforge/src/shared/db/migrations/011-vertical-profiles.sql)
- runtime helpers: [src/shared/vertical-profiles.ts](/root/general-projects/parallel-callforge/src/shared/vertical-profiles.ts)

Authoring path:

- CLI:
  - `npx tsx src/index.ts vertical-profile <verticalKey> <json-or-file>`

Current behavior:

- If a vertical profile exists in DB, it is used.
- If it does not exist, a built-in default is materialized and cached into DB on first load.

This is the "vertical orchestration layer" foundation. The vertical is the reusable schema/playbook. It is not the same thing as an individual buyer configuration.

### 2. Offer Profile

An offer profile is the monetization-specific constraint set inside a vertical.

Examples:

- `pestcontrol-1`
- `pestcontrol-2`
- `hvac-commercial-1`

This key is an internal profile key. It is not required to match any affiliate network naming.

The offer profile stores:

- raw offer text
- detected vertical
- normalized niche
- service scope
- allowed services
- disallowed services
- banned phrases
- required disclaimer
- traffic restrictions
- target call duration
- target ZIP spreadsheet sources

It is stored in:

- DB table: `offer_profiles`
- migration: [src/shared/db/migrations/010-offer-profiles.sql](/root/general-projects/parallel-callforge/src/shared/db/migrations/010-offer-profiles.sql)
- runtime helpers: [src/shared/offer-profiles.ts](/root/general-projects/parallel-callforge/src/shared/offer-profiles.ts)

Ingestion paths:

- CLI:
  - `npx tsx src/index.ts offer-profile <offerId> <raw-text-or-file>`
- Dashboard API:
  - `POST /api/offers/profile`
- Pipeline start API:
  - `POST /api/pipeline/start` with `rawOfferText`

The offer profile parser is currently heuristic. It is designed for practical control, not perfect semantic extraction.

Additional parser rule:

- external source URLs must preserve original character casing during parsing/storage

Reason:

- Google Sheets document IDs are case-sensitive
- lowercasing spreadsheet URLs corrupts the ID and breaks ZIP coverage sync from offer profiles

This specifically applies to `constraints.target_geo_sources`.

### 3. Runtime Execution State

At runtime, the system loads:

1. the offer profile
2. the matching vertical profile
3. a merged constraint set

Merge behavior:

- vertical defaults provide reusable baseline rules
- offer constraints override or narrow those defaults
- allowed services are unioned and then filtered by disallowed services
- disallowed services are unioned
- banned phrases are unioned
- required disclaimer prefers the offer-specific value, then falls back to the vertical default

The merged runtime constraints are what the agents should follow.

## Checkpointing

The pipeline now has a DB-backed checkpoint layer.

It is stored in:

- DB table: `agent_checkpoints`
- migration: [src/shared/db/migrations/009-agent-checkpoints.sql](/root/general-projects/parallel-callforge/src/shared/db/migrations/009-agent-checkpoints.sql)
- runtime helpers: [src/shared/checkpoints.ts](/root/general-projects/parallel-callforge/src/shared/checkpoints.ts)

Checkpoint design:

- checkpoints are keyed by:
  - `agent_name`
  - `scope_key`
  - `checkpoint_key`
- `scope_key` is a hash of the relevant runtime inputs
- checkpoints persist completion for useful substeps, not just whole-agent completion

Why this exists:

- reruns must not restart from the beginning of an agent
- completed work should be skipped
- retries should continue from the first missing unit of work

### Current Agent Checkpoint Behavior

`Agent 0.5`

- checkpoints saved deployment candidates for the same offer/ZIP input set
- reruns skip the full scan when the same candidate set already exists

`Agent 1`

- checkpoints deployment-candidate score writes per city
- checkpoints keyword clustering per city
- checkpoints whole-run completion for the candidate set

`Agent 2`

- checkpoints each research stage separately
- can resume from existing DB outputs for:
  - competitor analysis
  - design spec
  - copy framework
  - schema templates
  - seasonal calendar

`Agent 3`

- checkpoints hub pages
- checkpoints subpages
- checkpoints city completion
- checkpoints full build completion
- bootstraps checkpoints from existing `content_items` plus on-disk content files

This is why reruns now skip already-generated cities/pages instead of rebuilding from Shawnee.

`Agent 7`

- checkpoints whole monitoring completion for the current day and page set

## Agent Responsibilities Under the New Model

### Agent 0.5: Geo Scanner

File:

- [src/agents/agent-0.5-geo-scanner/index.ts](/root/general-projects/parallel-callforge/src/agents/agent-0.5-geo-scanner/index.ts)

Responsibilities:

- load or import ZIP coverage for the offer
- map ZIPs to cities
- rank deployment candidates
- write `deployment_candidates`

New behavior:

- if no ZIP coverage is stored for the offer and the offer profile contains target spreadsheet URLs, Agent 0.5 imports ZIP coverage directly from the offer profile before scoring
- Agent 0.5 now performs a geo-reference preflight before scoring:
  - it checks whether `geo_zip_reference` is large enough to be considered usable
  - if the table is badly undersized, it auto-runs the geo ZIP importer
  - if the table is still badly undersized after refresh, it fails loudly instead of continuing with degraded data

Operational stance:

- a few missing ZIP mappings are acceptable and are handled by the existing unmapped-ZIP thresholds
- a catastrophically missing reference dataset is not acceptable and should hard-fail

Current threshold:

- `geo_zip_reference` must have at least `30,000` rows before Agent 0.5 will trust it for scoring

This makes geography offer-driven instead of manually seeded.

### Agent 1: Keyword Research

File:

- [src/agents/agent-1-keywords/index.ts](/root/general-projects/parallel-callforge/src/agents/agent-1-keywords/index.ts)

Responsibilities:

- generate keyword templates
- fetch keyword metrics
- score cities
- cluster keywords into page opportunities
- write `city_keyword_map` and `keyword_clusters`

New behavior:

- keyword template prompts now include:
  - vertical core services
  - vertical exclusions
  - vertical keyword notes
  - offer allowed/disallowed services
  - offer service scope
- cached/generated keyword templates are filtered against the merged offer constraints
- disallowed service clusters are filtered out before they are saved

Result:

- if the offer says no bed bugs, Agent 1 should stop creating bed-bug page opportunities

### Agent 2: Design Research

File:

- [src/agents/agent-2-design/index.ts](/root/general-projects/parallel-callforge/src/agents/agent-2-design/index.ts)

Responsibilities:

- competitor analysis
- design specification
- copy framework
- schema templates
- seasonal calendar

New behavior:

- prompts now include:
  - vertical service taxonomy
  - vertical keyword and design notes
  - offer scope
  - offer allowed/disallowed services
  - offer banned phrases
  - offer disclaimer requirement

Result:

- design/copy research is now constrained by the monetization profile instead of being purely generic per niche

### Agent 3: Site Builder

File:

- [src/agents/agent-3-builder/index.ts](/root/general-projects/parallel-callforge/src/agents/agent-3-builder/index.ts)

Responsibilities:

- build Hugo templates
- generate hub pages
- generate service pages
- run QA
- build/deploy site

New behavior:

- only allowed service clusters are selected for page generation
- prompts include vertical and offer compliance rules
- generated content is normalized against offer rules:
  - banned phrases are replaced
  - disallowed service mentions are scrubbed
  - required disclaimer is appended if missing

Result:

- if a pest-control offer excludes bed bugs, Agent 3 should not create a bed-bug service page and should scrub those mentions from generated text if they leak through

### Agent 7: Performance Monitor

File:

- [src/agents/agent-7-monitor/index.ts](/root/general-projects/parallel-callforge/src/agents/agent-7-monitor/index.ts)

Responsibilities:

- monitor page performance
- write snapshots and alerts

Current change:

- mostly checkpointing and niche selection from the active offer context

Future work:

- optimization actions should eventually be vertical-aware so remediation strategies differ between pest control, HVAC, roofing, etc.

## Runtime Entry Points

### CLI

File:

- [src/index.ts](/root/general-projects/parallel-callforge/src/index.ts)

Current behavior:

- `offer-profile` command parses and saves an offer profile
- `vertical-profile` command saves a reusable vertical definition
- pipeline and single-agent runs load the offer profile first
- the runtime then loads the vertical profile and merges constraints
- downstream agents receive the merged runtime context

Offer targeting rule:

- offer-scoped CLI execution should use an explicit `offerId`
- the runtime should not silently fall back to a hidden global default offer

Reason:

- implicit offer selection creates incorrect runs that look valid while operating on the wrong context
- explicit offer targeting is safer than environment-driven hidden state for offer-bound agents

This applies to:

- `pipeline`
- `agent-1`
- `agent-2`
- `agent-3`
- any other execution path that depends on offer-scoped context

### Dashboard Server

File:

- [src/dashboard-server.ts](/root/general-projects/parallel-callforge/src/dashboard-server.ts)

Current behavior:

- `/api/offers/profile` can ingest raw offer text
- `/api/pipeline/start` accepts raw offer text and will parse/save it before starting
- pipeline tasks load the active offer profile and vertical profile before dispatching agents

Offer-selection rule:

- the dashboard should not silently auto-select an arbitrary stored offer when none is supplied
- if the run is offer-scoped, the caller should provide the intended offer explicitly

## Why `offerId` Exists

The code still uses the field name `offerId`, but functionally it is now a profile key.

It represents:

- one monetization profile
- one set of constraints
- one geography definition
- one resumable pipeline context

It should be named semantically like:

- `pestcontrol-1`
- `pestcontrol-2`
- `hvac-commercial-1`

This is intentional. Multiple buyers inside the same vertical can share the same vertical definition while having different offer-level restrictions.

## Architecture Summary

The current architecture is:

1. `vertical_profiles`
2. `offer_profiles`
3. `offer_geo_coverage`
4. `deployment_candidates`
5. Agent 1 research
6. Agent 2 research
7. Agent 3 generation
8. Agent 7 monitoring
9. `agent_checkpoints`

The important distinction is:

- vertical profile = reusable vertical playbook
- offer profile = specific buyer/compliance profile
- checkpoints = resumable execution state

## Current Limitations

The architecture is in place, but it is still early.

Known gaps:

- offer parsing is heuristic and not yet validated against a broader corpus of raw offer formats
- Agent 2 prompt schemas are still strongly oriented around pest-control phrasing, even though the orchestration layer can now switch verticals
- Agent 3 content schemas are still generic content objects with vertical-specific behavior injected via prompts and filters, not fully custom per vertical page schema
- there is now a CLI path for authoring custom vertical definitions, but there is not yet a dashboard UI/API flow for vertical-definition editing
- QA does not yet have a dedicated hard-fail rule that enumerates exact banned service tokens found in generated content

## Near-Term Direction

The intended direction is:

1. Keep vertical logic explicit.
2. Reuse vertical definitions across many offer profiles.
3. Keep offer profiles as strict monetization overlays.
4. Make every downstream agent read the merged runtime constraints.
5. Add stronger compliance QA so violations fail loudly instead of only being normalized silently.

That is the architecture this codebase is now moving toward.

## Vertical Strategy Interface

The codebase now also has an explicit vertical-strategy abstraction in:

- [src/shared/vertical-strategies.ts](/root/general-projects/parallel-callforge/src/shared/vertical-strategies.ts)

Backed by concrete strategy modules in:

- [src/verticals/types.ts](/root/general-projects/parallel-callforge/src/verticals/types.ts)
- [src/verticals/default/strategy.ts](/root/general-projects/parallel-callforge/src/verticals/default/strategy.ts)
- [src/verticals/pest-control/strategy.ts](/root/general-projects/parallel-callforge/src/verticals/pest-control/strategy.ts)

This is the execution-plane interface that sits on top of the data-plane layers (`vertical_profiles` and `offer_profiles`).

It currently defines:

- keyword-template prompt context
- design-research prompt context
- content-generation prompt context
- service-allowance logic

The agent code now calls strategy-owned prompt composers rather than assembling vertical wrappers inline. This means:

- Agent 1 delegates keyword-template prompt composition to the active vertical strategy
- Agent 2 delegates design-research prompt composition to the active vertical strategy
- Agent 3 delegates content prompt composition to the active vertical strategy

Current implementations:

- dedicated `pest-control` strategy module
- default generic strategy module used for `hvac`, `roofing`, and unknown verticals

Current prompt ownership:

- the `pest-control` strategy now owns its base Agent 1 / Agent 2 / Agent 3 prompt text
- the default strategy still reuses the legacy shared agent prompt files
- agents now request prompts from the active vertical strategy instead of directly assembling or selecting prompt strings themselves

Important:

- this is infrastructure, not a full prompt split yet
- the first goal is to give the orchestrator a stable per-vertical execution interface
- future work should move prompt builders, page schemas, route planning, and QA deeper into this strategy layer

This means the system now has both:

- data-plane vertical definitions (`vertical_profiles`)
- execution-plane vertical strategies (`vertical-strategies`)

That is the intended foundation for eventually having fully distinct per-vertical prompt and schema stacks.

## March 2, 2026 Run-Time Decisions

The following decisions were added during the `pestcontrol-1` pipeline debugging and Agent 3 hardening work.

### Limiters Are Off By Default During Build / Optimization

Until explicitly re-enabled, limiter enforcement should be treated as disabled during active build and optimization work.

This includes:

- provider rate limiters
- content deploy limiters
- other automatic throttles that slow internal generation work

Reason:

- internal generation, research, and refinement work should not be blocked while the system is still building content
- hidden throttling made active runs look hung when they were actually waiting on limiter state

Operational rule:

- no limiter should gate normal generation unless explicitly turned back on by operator decision

### Content Creation Must Not Be Capped

The system should distinguish between:

- creating content
- publishing content

Creation should be effectively uncapped.

This means the system should be allowed to:

- generate many city pages ahead of time
- save them in the repo
- save them in the database
- keep them staged and ready for later release

This is not considered a risk by itself.

The only place where gating belongs is publication / release control.

That enables future workflows such as:

- scheduled releases
- staged publication windows
- separate build and launch phases
- later publishing by another agent running on a schedule

Practical consequence:

- weekly new-city caps should not block content generation
- if a cap exists, it should apply only to actual launch / publish actions

### Agent 3 Weekly New-City Cap Is Disabled By Default

Agent 3 previously used a weekly new-city cap in the content-generation path.

That was the wrong scope.

The cap is now disabled by default for Agent 3 content builds, because:

- it blocked page creation instead of publication
- it caused new cities to be silently skipped during normal builds
- it prevented pre-generating content for later release

If publication gating is needed later, it should be implemented in the release path, not the page-construction path.

### Agent 3 Must Log Silent Wait States Explicitly

Agent 3 had multiple phases that could appear hung because they emitted no progress logs.

The system should now explicitly log:

- limiter waits and acquisitions (if limiters are ever reintroduced)
- image-resolution steps
- template review steps
- template validation steps

Reason:

- a silent wait is operationally indistinguishable from a hang
- build logs must reveal where time is being spent

### Image Sourcing Must Be Opt-In

Agent 3 should not attempt remote stock-image retrieval unless at least one image provider key is configured.

Specifically:

- do not try remote image fetches unless `PEXELS_API_KEY` or `PIXABAY_API_KEY` is present
- if no key is configured, use generated placeholder imagery immediately

Reason:

- remote image lookup should not block or destabilize content generation
- placeholder images are acceptable defaults until image providers are configured

Operational rule:

- lack of image API keys is a normal state, not an error state

### Generated Hugo Templates Require Review Before Use

LLM-generated Hugo templates are allowed, but they must not be written blindly.

A generated template must pass three stages before being trusted:

1. structural review / normalization
2. cache write of the reviewed version
3. Hugo validation run

Reason:

- generated templates can be structurally invalid even when they satisfy the output schema
- in this session, the model emitted nested `{{ define ... }}` blocks inside `{{ define "main" }}`, which Hugo rejects

### Template Cache Must Heal Bad Entries

Cached generated templates are not inherently trustworthy.

If cached templates fail structural review, the system should:

- treat the cache as poisoned
- discard that cached entry logically
- regenerate fresh templates
- re-run review and validation

It should not keep reusing a broken cached template indefinitely.

### Generated Template Validation Is a Hard Gate

After template review, Agent 3 should run a real Hugo validation step before moving on to content generation.

If template validation fails:

- stop the run
- surface the exact Hugo error

Do not proceed with page generation on invalid templates.

This is a required quality gate, not optional best-effort behavior.

### Agent 3 QA Should Auto-Repair Certain Content Failures

Some QA failures are fixable without discarding the page entirely.

Agent 3 should automatically attempt a repair pass when the only failures are within a repairable class.

Current repairable classes:

- `placeholder_tokens`
- `banned_phrases`

Reason:

- these failures often come from otherwise usable content
- a targeted rewrite is faster and less wasteful than full regeneration
- in this session, Deland content failed only because of the phrase `when it comes to`, which is an AI-style banned phrase and should be rewritten rather than causing a hard stop

The repair prompt should:

- remove exact banned phrases that were detected
- remove generic banned phrase patterns from the known blocklist
- replace any placeholder tokens with concrete copy
- preserve page intent, locality, and word-count requirements

### Checkpointed Pages With Placeholder Tokens Must Not Be Reused

Checkpoint reuse should not blindly trust prior generated files.

If an existing content file still contains placeholder tokens, Agent 3 should:

- treat that file as invalid for reuse
- regenerate the page instead of skipping it

Reason:

- stale checkpointed content with unresolved placeholders can silently poison future builds
- reusing invalid files defeats downstream QA and creates misleading “successful” reuse

### Built Artifact QA Currently Reflects the Entire Built Site

Built artifact QA currently scans all generated HTML in the built output, not just pages created in the current run.

This matters because:

- stale legacy pages can still fail build QA even if newly generated pages are clean
- unrelated historical placeholder pages can block a current pipeline run

That behavior is currently exposing real risk, but it also means the system still needs a cleaner strategy for:

- staged historical content
- per-run build scope
- release-ready subsets vs. legacy generated pages

The immediate rule remains:

- if built HTML contains placeholders anywhere, artifact QA should fail loudly

But future release logic should separate:

- current build artifacts
- staged content not intended for release
- legacy content that should be retired or excluded

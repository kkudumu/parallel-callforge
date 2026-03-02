# PRODUCT REQUIREMENTS DOCUMENT

## CallForge

AI-Powered Multi-Agent System for Programmatic Pay-Per-Call Lead Generation

Version 9.0  |  March 2026  
Author: Kioja Kudumu  
Classification: Internal / Build-in-Public  
First deployment target: extermanation.com (Pest Control)

## V9 ADDENDUM: Portfolio Control and Execution Tightening

Deployment Velocity Enforcement | Monitoring Data Fidelity | Closed-Loop Optimization Dispatch | Legal Template Hardening

## 25. Portfolio Control and Execution Tightening

This addendum documents the next production-hardening layer implemented after the V8 addendum. V8 established data contract enforcement, rate limiting, dead-letter queue handling, SEO velocity policy, and legal requirements. V9 converts those policy requirements into more concrete runtime behavior inside the active MVP codebase.

The objective of V9 is not to introduce new agents. The objective is to make the existing agents behave more like a controlled lead generation portfolio rather than a batch content generator.

### 25.1 Deployment Velocity Enforcement in Agent 3

The V8 addendum defined a hard content deployment cap of 3 cities per week. Prior to V9, the codebase contained a `contentDeploy` Bottleneck configuration, but the actual Agent 3 execution path did not enforce that rule at the point of city build and registration.

V9 resolves this gap by enforcing weekly new-city gating directly in Agent 3:

- Agent 3 now checks the `pages` table for city hubs created within the last 7 days.
- New city launches are capped by `maxNewCitiesPerWeek` (default 3).
- Existing cities may still be rebuilt or refreshed without consuming new-city launch capacity.
- When the shared `contentDeploy` limiter is supplied by the runtime, each city build is also routed through that limiter for in-process control.

This produces two layers of protection:

1. Database-backed weekly gating that survives process restarts
2. In-process limiter protection that prevents burst execution inside a single long-running process

This change operationalizes the V8 rollout calendar rather than leaving it as a policy-only document.

### 25.2 Monitoring Data Fidelity in Agent 7

Before V9, Agent 7 attempted to write performance data using field names that did not match the real `performance_snapshots` schema. This created a hidden reliability risk: the monitoring agent appeared to run, but the persistence contract was not aligned with the database design.

V9 corrects this by aligning Agent 7 writes to the actual schema:

- `sessions`
- `users`
- `pageviews`
- `organic_sessions`
- `click_to_call_count`
- `calls_total`
- `calls_qualified`
- `revenue`

The agent now derives these fields from the current metrics provider in a consistent way:

- organic sessions are proxied from click volume
- click-to-call counts are derived from click-to-call rate
- qualified calls are derived from call qualification rate
- revenue is derived from qualified calls multiplied by representative payout assumptions

The `performance_snapshots` row now updates on conflict for `(page_id, snapshot_date)` rather than silently doing nothing. This makes Agent 7 useful as a daily state refresher instead of a one-write-per-day no-op once the first row exists.

### 25.3 Closed-Loop Optimization Dispatch

V7 and V8 both assume Agent 7 is the central feedback engine. However, before V9, Agent 7 stored optimization recommendations in `optimization_actions` without turning those recommendations into executable work. The system could diagnose but not act.

V9 closes that gap:

- Agent 7 still writes `optimization_actions` for auditability.
- Agent 7 now also inserts follow-up records into `agent_tasks` for unresolved optimization work.
- Task insertion is deduplicated against existing `pending` and `running` tasks for the same page and action type.

This converts threshold breaches into actual downstream execution:

- `content_refresh` → Agent 3
- `cta_optimization` → Agent 3
- `keyword_refinement` → Agent 1

This is the first real “self-healing” behavior in the MVP. It is still narrow in scope, but it changes the system from passive monitoring to active orchestration.

### 25.4 Targeted Follow-Up Execution

A naive closed loop would still be wasteful if every optimization task triggered a full portfolio rebuild. V9 improves this by allowing targeted city scoping in task execution paths:

- Agent 3 can now be instructed to rebuild only a specific city
- Agent 1 can now be instructed to focus on a specific city/state candidate when the payload provides it
- `keyword_refinement` tasks can force-refresh research for the targeted city rather than waiting for the normal cache window

This preserves the resource discipline established in V8:

- reuse cache when possible
- refresh intentionally when signal quality demands it
- avoid unnecessary full-run portfolio churn

### 25.5 Legal Template Hardening

V8 specified four non-negotiable legal and disclosure elements:

1. Footer disclaimer
2. Privacy Policy
3. Terms of Service
4. Do Not Sell My Personal Information
5. CTA-adjacent call recording disclosure

The MVP already contained partial disclaimer coverage, but it was not yet standardized into a stronger default implementation. V9 hardens the generated site templates by:

- expanding the footer disclaimer to clearly state the referral-service role
- adding permanent links to privacy, terms, and do-not-sell pages
- adding call recording disclosure adjacent to header CTAs and sticky CTAs
- generating default compliance pages in the Hugo content tree for:
  - `/privacy-policy/`
  - `/terms-of-service/`
  - `/do-not-sell/`

This does not replace legal review. It does move the system from “partial disclosure” to “built-in baseline compliance scaffolding.”

### 25.6 Quality Gate Tightening

The original quality gate focused on:

- minimum word count
- city-name presence
- banned generic AI phrases

That was useful for basic hygiene but insufficient for a competitive local SEO risk model. V9 raises the floor by adding city mention density checks:

- city pages must now mention the city multiple times, not just once
- the threshold scales with content length
- a page can now fail for `city_name_sparse` even if it technically includes the city

This is still not the full PRD target state. It is the first step toward preventing pages that pass minimum length but still read like thin, low-locality content.

### 25.7 Business Impact

The V9 changes improve business performance in four ways:

1. They reduce the risk of over-publishing new cities too quickly and triggering indexation or quality suppression.
2. They make monitoring data trustworthy enough to support real operating decisions.
3. They make optimization recommendations actionable instead of inert.
4. They reduce legal/compliance sloppiness in page generation before scale.

In practical terms, V9 moves the system closer to a managed portfolio operator:

- slower but safer city rollout
- cleaner monitoring history
- more credible remediation loops
- stronger baseline trust and disclosure posture

### 25.8 Remaining Gaps After V9

V9 does not complete the full PRD roadmap. The following high-value systems remain intentionally deferred:

- a database-backed opportunity queue replacing hardcoded city arrays
- payout-aware scoring from network intelligence or offer data
- cache source versioning for estimated keyword data vs official Google Ads API data
- a real Agent 7 data provider replacing mock-only metrics
- an indexation kill switch driven by Search Console / URL Inspection data
- a stronger uniqueness gate using local data points, structured local facts, and similarity scoring

These remain the highest-priority candidates for V10.

### 25.9 Updated Working Agreements

Add the following to the active engineering working agreements:

- New city deployment policy must be enforced in runtime code, not only in documentation.
- Agent 7 must write only to fields that exist in the production schema.
- Every optimization action that is intended to be executable must also produce a corresponding task record.
- Agent handlers should honor task payload scope whenever safe to avoid full portfolio reruns.
- CTA-adjacent recording disclosure and footer legal links are mandatory baseline template elements.

### 25.10 Updated Risk Register Entries

Add or revise the following risks:

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Velocity policy exists but is not enforced in code | Medium | Critical | Agent 3 now enforces weekly new-city gating and uses the content deployment limiter when supplied |
| Monitoring decisions are based on invalid or miswritten snapshot data | High | High | Agent 7 write path aligned to the real `performance_snapshots` schema |
| Optimization recommendations accumulate without execution | High | High | Agent 7 now dispatches deduplicated follow-up tasks into `agent_tasks` |
| Legal disclosure drift across generated pages | Medium | Critical | Hugo templates now include stronger footer links, CTA recording notices, and generated compliance pages |
| City pages pass minimum length but remain thin/locality-poor | Medium | High | Quality gate now enforces stronger city mention density as a first anti-thin-content control |

## 26. Agent 0.5: Geo Opportunity Scanner

Agent 0.5 is a new upstream deterministic filtering layer that sits between raw offer geography coverage and Agent 1 keyword research.

Its purpose is to convert large ZIP-code allowlists from pay-per-call offers into a ranked city shortlist before expensive keyword research runs.

### 26.1 Why Agent 0.5 Exists

Pay-per-call offers often expose very large batches of eligible ZIP codes. Running full keyword research across every ZIP is operationally wasteful and strategically noisy:

- many ZIPs collapse into the same real deployment city
- many ZIPs represent thin edge coverage rather than strong city-wide coverage
- many adjacent ZIPs will produce redundant keyword profiles
- the token and runtime cost of deep keyword research scales badly when the input is left at ZIP granularity

Agent 0.5 solves this by reducing the search space before Agent 1 executes.

### 26.2 Responsibility Split

Agent 0.5 and Agent 1 solve different problems:

- Agent 0.5 determines which geographies are worth researching
- Agent 1 determines whether those shortlisted geographies have sufficient search demand and the right intent profile

This distinction is critical. Agent 0.5 should not fabricate search demand estimates. It should score structural opportunity using deterministic inputs available before keyword research.

### 26.3 Deterministic Scoring Without ZIP-Level Keyword Research

In many offers, payout is effectively flat across the allowed geographies. When payout is not materially different between ZIPs, ZIP-level payout does not help rank one ZIP over another.

That means the initial scoring model should focus on deterministic coverage opportunity, not final revenue:

`pre_keyword_score = coverage_score + population_score + density_score + spread_penalty + deployment_fit_score`

Where:

- `coverage_score`: number of eligible ZIPs that map into the city
- `population_score`: city population or a close local proxy
- `density_score`: how concentrated the usable ZIP coverage is within the city cluster
- `spread_penalty`: penalty for fragmented, low-coherence ZIP patterns
- `deployment_fit_score`: business-rule filters such as target population band and operational practicality

This produces a deterministic shortlist that is accurate about coverage opportunity, even before Agent 1 adds search demand data.

### 26.4 Core Workflow

The Agent 0.5 workflow is:

1. Ingest an offer and its allowed ZIP-code list
2. Normalize ZIP strings and remove invalid or duplicate entries
3. Map ZIPs to city/state using a local geo reference table
4. Aggregate ZIPs into city-level coverage clusters
5. Score each city using deterministic pre-keyword logic
6. Write ranked city candidates to a shared table
7. Hand only the top ranked candidates to Agent 1 for keyword demand and intent analysis

This makes the first pass fast, cheap, and explainable.

### 26.5 Recommended Data Model

Add these tables:

- `geo_zip_reference`
  - zip_code
  - city
  - state
  - county
  - latitude
  - longitude
- `offer_geo_coverage`
  - offer_id
  - zip_code
  - source
  - created_at
- `deployment_candidates`
  - offer_id
  - city
  - state
  - zip_codes
  - eligible_zip_count
  - population
  - pre_keyword_score
  - keyword_score
  - final_score
  - status
  - reasoning
  - created_at
  - updated_at

### 26.6 Relationship To Agent 1

Agent 0.5 does not replace Agent 1.

Instead:

- Agent 0.5 reduces a large ZIP universe into a smaller city universe
- Agent 1 applies keyword demand and intent validation to that reduced set
- final deployment decisions should be based on a combined score derived from both layers

This is the correct path to expected-value ranking without paying keyword-research cost on every ZIP.

### 26.7 Implementation Priority

Agent 0.5 should begin as a deterministic system with no LLM dependency:

- no keyword estimation at ZIP level
- no synthetic intent inference
- no prompt-based filtering

The first implementation should be pure data normalization, aggregation, and deterministic ranking. Only after that is stable should Agent 1 enrich the top ranked candidates.

### 26.8 Business Impact

Adding Agent 0.5 improves the portfolio model in four ways:

1. Reduces keyword research runtime and token cost dramatically during market expansion
2. Prevents redundant keyword work across ZIPs that map to the same city opportunity
3. Makes city targeting more explainable and systematic
4. Creates a clean path to future expected-value ranking once keyword and payout enrichment are layered in

## End of Sections 25-26

This section should be read in conjunction with:

- the original PRD Sections 1-23
- the V8 addendum (Section 24)
- the implementation plan and optimization execution docs in this repository

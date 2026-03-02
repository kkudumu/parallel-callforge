# CallForge Optimization Plan

## Objective

Align the current MVP implementation with the highest-leverage business and production-hardening requirements implied by PRD v7 and PRD v8, with emphasis on:

- Better capital allocation
- Real deployment throttling
- Stronger closed-loop optimization
- Higher monitoring fidelity
- Legal/compliance enforcement in generated assets

## Current State

The codebase already includes:

- LLM schema enforcement with Zod validation and self-correction
- Provider rate limiting and fallback routing
- Dead-letter queue handling
- Freshness-aware research caching
- Force-refresh overrides in the dashboard

The main remaining gaps are:

- Static city targeting instead of an opportunity queue
- Deployment velocity controls defined but not enforced at the actual build/deploy path
- Agent 7 writes that do not match the real database schema
- Optimization actions that are recorded but not converted into executable work
- Thin quality/compliance checks relative to PRD requirements
- No real indexation kill switch or live Search Console data source

## Execution Order

### Phase 1: Operational Control

1. Enforce content deployment throttling in Agent 3 using the existing `contentDeploy` Bottleneck limiter.
2. Correct Agent 7 performance snapshot writes so monitoring data lands in the real schema.
3. Convert Agent 7 optimization actions into follow-up tasks that can be executed by the orchestrator.

### Phase 2: Quality and Compliance

4. Expand Agent 3 quality gating to include compliance and anti-doorway checks:
   - call recording disclosure near CTAs
   - footer legal links
   - stronger uniqueness/local signal checks where possible without external data
5. Upgrade Hugo default partials so the baseline templates include:
   - privacy policy link
   - terms of service link
   - do not sell link
   - CTA-adjacent call recording notice

### Phase 3: Portfolio Logic

6. Replace hardcoded city arrays with a DB-backed opportunity queue.
7. Add payout-aware scoring inputs to Agent 1 once network intelligence or Google Ads data is available.
8. Add cache source versioning so “estimated” keyword data and “official Google Ads” data are distinguishable.

### Phase 4: Full PRD Alignment

9. Replace Agent 7 mock data with a real provider abstraction for:
   - indexation
   - rankings
   - click-to-call counts
   - qualified calls
   - revenue
10. Implement the PRD v8 deployment kill switch:
   - if indexation ratio is below threshold for the configured window, block new city deployments

## What Will Be Executed In This Pass

This implementation pass will execute the highest-value work that can be completed safely without introducing major new external dependencies:

1. Deployment throttling in Agent 3
2. Agent 7 schema fidelity fix
3. Optimization action dispatch into `agent_tasks`
4. Quality/compliance expansion in Agent 3 and Hugo templates
5. Documentation update in a new PRD v9 addendum

## Deferred Work

These items are intentionally deferred because they require new data sources, broader schema design, or larger business-logic changes:

- DB-backed opportunity queue
- Payout-aware market intelligence (Agent 0 or equivalent)
- Real Search Console / URL Inspection ingestion
- Google Ads API keyword quality scoring
- EV-based refresh prioritization

## Success Criteria

This pass is successful if:

- Agent 3 cannot exceed the configured deployment reservoir when the shared limiter is supplied
- Agent 7 writes cleanly into the existing snapshot schema
- Threshold breaches create actionable downstream tasks instead of dead rows
- Generated pages include the minimum legal disclosures from PRD v8
- The new PRD v9 addendum accurately documents the new behavior

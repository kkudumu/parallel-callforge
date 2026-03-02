# Agent 0.5 Implementation Plan

## Name

Agent 0.5: Geo Opportunity Scanner

## Purpose

Transform large ZIP coverage lists from pay-per-call offers into a deterministic, ranked city shortlist before Agent 1 performs deep keyword research.

This agent sits between raw offer coverage and keyword research. Its job is not to determine final demand. Its job is to reduce the search space.

## Why This Exists

If an offer returns hundreds or thousands of allowed ZIP codes, running full keyword research across every ZIP is wasteful and duplicative.

ZIP codes should be treated as coverage signals, not as the final unit of deployment.

Agent 0.5 creates a city-level shortlist using deterministic scoring based on:

- coverage density
- population opportunity
- ZIP clustering into the same city/metro
- deployment feasibility
- later, optional keyword enrichment from Agent 1

## Core Principle

Agent 0.5 is a deterministic geo filter.

It should not pretend to know search demand without keyword data.
It should rank opportunities based on what is knowable before keyword research, then hand the best candidates to Agent 1 for demand validation.

## What Agent 0.5 Does

1. Accepts an offer and its allowed ZIP list.
2. Normalizes ZIPs using a local geo reference dataset.
3. Maps ZIPs to city/state.
4. Groups ZIPs into city-level coverage clusters.
5. Calculates a pre-keyword opportunity score.
6. Produces a ranked shortlist of city candidates.
7. Hands only the top slice to Agent 1 for keyword scoring and intent analysis.

## What Agent 0.5 Does Not Do

- It does not replace Agent 1.
- It does not estimate search volume from thin air.
- It does not make the final deployment decision alone.

It is a candidate reducer.

## Deterministic Scoring Model

Because payout is typically flat across an offer, the pre-keyword score should not overfit payout.

The pre-keyword score should instead focus on structural opportunity:

`pre_keyword_score = coverage_score + population_score + density_score + spread_penalty + deployment_fit_score`

### Components

1. `coverage_score`
- How many eligible ZIPs fall into the city.
- More eligible ZIPs generally means broader buyer acceptance across the city.

2. `population_score`
- Use city population from local data.
- Larger cities are more likely to support meaningful search volume.

3. `density_score`
- Reward cities where eligible ZIPs represent concentrated usable coverage rather than thin edge coverage.

4. `spread_penalty`
- Penalize fragmented ZIP sets that technically map to a city but imply weak operational coherence.

5. `deployment_fit_score`
- Reward cities that align with your practical criteria:
  - target population band
  - legal comfort
  - niche fit
  - content uniqueness feasibility

## How Accuracy Works

Agent 0.5 is accurate at a different layer than Agent 1.

- Agent 0.5 is accurate about *coverage opportunity*.
- Agent 1 is accurate about *search demand and keyword intent*.

You do not need keyword data for every ZIP to be deterministic.
You need a deterministic way to decide which cities are worth researching.

That is the correct split.

## Recommended Data Model

### New Tables

1. `geo_zip_reference`
- zip_code
- city
- state
- county
- latitude
- longitude
- population_estimate (optional if ZIP-level data available)

2. `offer_geo_coverage`
- id
- offer_id
- zip_code
- source
- created_at

3. `deployment_candidates`
- id
- offer_id
- city
- state
- zip_codes (TEXT[])
- eligible_zip_count
- population
- pre_keyword_score
- keyword_score
- final_score
- status (`pending`, `researched`, `approved`, `rejected`, `deployed`)
- reasoning (JSONB)
- created_at
- updated_at

## Output Contract

Agent 0.5 should output a ranked shortlist like:

- city
- state
- population
- eligible_zip_count
- zip_codes
- pre_keyword_score
- reason summary

Agent 1 should consume only the top N candidates from this table.

## Execution Strategy

### Phase 1: Deterministic Only

Implement Agent 0.5 as a deterministic scorer without any LLM calls.

This keeps it:

- fast
- cheap
- explainable
- stable

### Phase 2: Hybrid

After the deterministic shortlist exists, optionally allow Agent 1 to enrich the top candidates with keyword data and produce a final combined score.

`final_score = weighted(pre_keyword_score, keyword_score)`

## Step-by-Step Coding Tasks

1. Add a migration for:
- `geo_zip_reference`
- `offer_geo_coverage`
- `deployment_candidates`

2. Add Zod schemas for:
- `deployment_candidates`
- `offer_geo_coverage`

3. Create a new agent directory:
- `src/agents/agent-0.5-geo-scanner/`

4. Implement ZIP normalization utilities:
- normalize ZIP strings
- validate 5-digit ZIPs
- de-duplicate imported coverage lists

5. Implement geo mapping utilities:
- ZIP to city/state lookup
- fallback handling for missing ZIP mappings

6. Implement city aggregation:
- group ZIPs by city/state
- collect all ZIPs per city
- count eligible ZIPs per city

7. Implement deterministic scoring:
- coverage score
- population score
- density score
- spread penalty
- deployment fit score

8. Write ranked results into `deployment_candidates`.

9. Update Agent 1 so it can read candidates from `deployment_candidates` instead of only accepting hardcoded city arrays.

10. Add a dashboard/API path to trigger Agent 0.5 from a pasted ZIP list or stored offer import.

11. Add tests for:
- ZIP normalization
- city aggregation
- deterministic scoring
- candidate ranking stability

12. After the deterministic path is stable, add an optional second-stage Agent 1 integration:
- top candidates only
- keyword demand enrichment
- final combined score

## MVP Recommendation

For the first version:

- do not LLM this
- do not keyword every ZIP
- do not build a full Agent 0 yet

Build Agent 0.5 as a deterministic city shortlisting engine and route the shortlist into Agent 1.

That gives you the biggest leverage with the least complexity.

## Success Criteria

Agent 0.5 is successful if:

- a large ZIP list collapses into a much smaller city shortlist
- the shortlist is deterministic for the same input
- Agent 1 only runs on shortlisted cities
- the runtime and token cost of initial market expansion drops materially
- the resulting city list is explainable in business terms

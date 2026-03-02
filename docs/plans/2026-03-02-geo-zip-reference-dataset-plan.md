# Geo ZIP Reference Dataset Plan

## Objective

Create a reliable, importable `geo_zip_reference` dataset for Agent 0.5 so the system can map ZIP codes to:

- `zip_code`
- `city`
- `state`
- `county`
- `latitude`
- `longitude`
- `population_estimate` (optional for first pass)

The goal is to support deterministic ZIP-to-city clustering for `offer_geo_coverage` imports already stored in the database.

## Research Summary

### Recommended Primary Source: GeoNames US Postal Code Data

Recommended source:

- GeoNames main site: https://www.geonames.org/
- GeoNames export docs: https://www.geonames.org/export/

Why this is the best fit for the current system:

- It includes 5-digit US postal codes.
- It includes place name, admin area names, latitude, longitude, and an accuracy field.
- It is downloadable in bulk.
- It is deterministic and script-friendly.
- It is licensed for reuse under CC BY 4.0.

Important caveat:

- GeoNames postal city names are not guaranteed to match USPS preferred city naming exactly.
- Some ZIPs may appear multiple times and require deterministic deduplication.
- It is a practical operational dataset, not a perfect canonical USPS licensing substitute.

### Secondary Source To Keep In Reserve: HUD USPS Crosswalk

Reference:

- https://www.huduser.gov/portal/datasets/usps_crosswalk.html

Why this is not the first implementation choice:

- It is excellent for ZIP-to-county / tract / CBSA allocation.
- It is updated frequently.
- But it is more useful as a crosswalk and enrichment layer than as the fastest first-pass ZIP centroid dataset.
- It also has access friction compared with a simple direct download workflow.

Best future use:

- county refinement
- CBSA enrichment
- address-ratio weighting

### Secondary Source To Keep In Reserve: Census ZCTA Files

Reference:

- ZCTA overview: https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html
- Gazetteer files: https://www.census.gov/geographies/reference-files/2020/geo/gazetter-file.html

Why this is not the first implementation choice:

- ZCTAs are not the same thing as USPS ZIP codes.
- They are useful for statistical and geometry work.
- They are weaker as a direct operational replacement for the actual ZIP lists already used by offers.

Best future use:

- population enrichment
- shape-driven clustering
- downstream analytics

## Recommendation

Use a **script**, not a new agent, for the first implementation.

Reason:

- This is a deterministic data-ingestion and normalization task.
- It does not need LLM judgment.
- It should be repeatable, testable, and runnable on demand.
- A script is the lowest-complexity and highest-reliability path.

An agent would only make sense later if you want:

- periodic dataset refresh orchestration
- anomaly detection
- multi-source reconciliation

For now, the right implementation is:

1. one import script
2. one optional test file
3. one package script entry

## Proposed Implementation

### New Script

Create:

- `src/shared/db/import-geo-zip-reference.ts`

Add package script:

- `import:geo-zips`

### Input Source

Download the GeoNames US postal data file at runtime.

Implementation should support:

1. primary URL from GeoNames
2. optional mirror fallback only if the primary URL fails

The script should not commit the raw upstream file into the repo unless explicitly requested.

### Expected GeoNames Fields

The US postal data is tab-delimited and includes, at minimum, fields in this shape:

1. country code
2. postal code
3. place name
4. admin name 1
5. admin code 1
6. admin name 2
7. admin code 2
8. admin name 3
9. admin code 3
10. latitude
11. longitude
12. accuracy

### Mapping Into `geo_zip_reference`

Map fields as follows:

- `zip_code` = normalized 5-digit postal code
- `city` = `place name`
- `state` = normalized 2-letter abbreviation derived from `admin code 1` or `admin name 1`
- `county` = `admin name 2` when present
- `latitude` = parsed numeric latitude
- `longitude` = parsed numeric longitude
- `population_estimate` = `NULL` for phase 1

### Normalization Rules

1. Keep only US rows.
2. Normalize ZIPs to exactly 5 digits.
3. Trim whitespace from all string fields.
4. Convert full state names to two-letter abbreviations if needed.
5. Drop invalid rows with missing ZIP, city, or state.

### Deduplication Rules

Some ZIPs may have multiple rows. Deduplicate per `zip_code` using a deterministic rule:

1. Prefer the row with the highest `accuracy`.
2. If tied, prefer the row with both latitude and longitude present.
3. If tied, prefer the row with a non-empty county.
4. If tied, sort by `city`, then `state`, then `county` and take the first.

This prevents nondeterministic row selection.

### Database Write Strategy

Use a transactional replace strategy:

1. Download and parse the full upstream dataset.
2. Build the normalized deduped in-memory row set.
3. `BEGIN`
4. `TRUNCATE geo_zip_reference`
5. Bulk insert all normalized rows
6. `COMMIT`

If anything fails:

- `ROLLBACK`

This is cleaner than incremental upserts for a full reference dataset.

### Optional Phase 1.5 Enhancement

If time allows in the same implementation pass:

- add a small `source_summary` log output:
  - raw row count
  - valid row count
  - deduped final row count
  - duplicate ZIP count
  - invalid row count

This makes refreshes auditable.

## Phase 2 (Deferred)

After the first import works, add optional enrichment:

1. county refinement from HUD USPS crosswalk
2. population approximation from Census ZCTA / API
3. provenance columns for the reference table itself
4. quarterly refresh cadence

None of that is required for Agent 0.5 MVP operation.

## Deliverables

The implementation pass should produce:

1. `src/shared/db/import-geo-zip-reference.ts`
2. package script `import:geo-zips`
3. optional test file for parsing/deduplication
4. successful DB load into `geo_zip_reference`
5. a short command note in the final response describing how many rows were imported

## Success Criteria

This plan is successful if:

- `geo_zip_reference` is populated with a deterministic US ZIP lookup table
- Agent 0.5 can map imported offer ZIPs into city/state clusters
- repeated imports produce the same final row set for the same upstream file
- the import path is script-based and does not require LLM calls

## Explicit Non-Goals

This implementation should not:

- create a new autonomous agent for this task
- use LLM prompting to infer missing geographic fields
- attempt ZIP-boundary polygon generation
- treat ZCTAs as a silent replacement for real ZIP codes

## Recommended Next-Chat Implementation Prompt

Use this prompt in a new chat:

`Implement the plan in /root/general-projects/parallel-callforge/docs/plans/2026-03-02-geo-zip-reference-dataset-plan.md. Use a script-first approach, not a new agent. Create src/shared/db/import-geo-zip-reference.ts, add an npm script import:geo-zips, use GeoNames US postal code data as the primary source, normalize and deterministically dedupe ZIP rows, and load the final result into geo_zip_reference in a transaction. Add focused tests for parsing and deduplication if practical, then run the import and report final row counts.`

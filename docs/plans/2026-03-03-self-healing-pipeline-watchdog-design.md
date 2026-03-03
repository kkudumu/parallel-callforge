# Self-Healing Pipeline Watchdog Design

**Date**: 2026-03-03
**Scope**: Always-on pipeline observer with autonomous error recovery, pattern learning, and institutional memory
**Status**: Approved — ready for implementation

---

## Problem

Pipeline failures (Hugo template errors, LLM malformed output, geo reference gaps, etc.) currently crash the run with no recovery. Each failure requires manual diagnosis, a code fix, and a restart. Patterns repeat across runs because nothing learns from them.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Two loosely-coupled systems (inline wrapper + background learner) | Wrapper gets zero-latency recovery; learner gets pattern intelligence. Neither blocks the other. |
| LLM repair invocation | Error + broken code → LLM → fixed code | Same as handing Claude an error in chat. No structured schema needed. Simple, robust. |
| LLM fallback chain | Claude → Codex → Gemini | Use existing `createLlmClient` priority order. Each CLI already has rate limiting wired in. |
| Repair rate limiting | Shared with existing `createRateLimiters()` instance | Prevents repair calls from flooding API limits on top of normal agent calls. |
| Rollback before fix | Snapshot current state before applying any LLM fix | If the fix corrupts further, restore snapshot so next run starts clean. |
| run_id threading | UUID generated at pipeline start, passed through all agents | Groups all steps of a single run in `pipeline_run_log` for pattern analysis. |
| Watchdog startup | Child process spawned by pipeline, killed when pipeline exits | Always-on while work is happening, never orphaned when idle. |
| Knowledge persistence | DB table (`learned_repair_patterns`) + markdown (`docs/watchdog/learned-patterns.md`) | DB for querying/promotion logic; markdown for human readability and git history. |
| Code promotion threshold | 5 occurrences → watchdog patches TypeScript source + commits | Balances confidence in the pattern vs. premature hardcoding. |
| Scope of observation | All agent steps, success AND failure | Success patterns reveal what to lean into; failure patterns reveal what to harden. |

---

## Architecture

```
pipeline start
    │
    ├── generate run_id (UUID)
    ├── spawn WatchdogAgent (child process)
    │
    ▼
withSelfHealing(agentFn, context)       src/shared/self-healing.ts
    │
    ├── call fn()
    │   ├── SUCCESS → log to pipeline_run_log (status=success) → done
    │   └── FAILURE →
    │         1. snapshot current state (templates / checkpoints / files)
    │         2. log to pipeline_run_log (status=failed, error, context)
    │         3. build repair prompt: error + broken code
    │         4. try Claude → Codex → Gemini (via createLlmClient fallback)
    │         5. apply fixed code to correct files
    │         6. retry fn() — up to 3 attempts total
    │         7a. RECOVERED → log (status=recovered, model_used, fix_applied)
    │         7b. DEAD (3 failures) → restore snapshot, log (status=dead), re-throw
    │
    ▼
pipeline_run_log (DB)                   one row per agent step per run

    │
    ▼ (every 60s)
WatchdogAgent                           src/agents/agent-watchdog/index.ts
    │
    ├── read unanalyzed pipeline_run_log entries
    ├── cluster by (agent_name, step, error_message_signature)
    ├── NEW FAILURE PATTERN (2+ occurrences):
    │     → LLM: "here are N occurrences, what's root cause + permanent fix?"
    │     → write to learned_repair_patterns (type=failure_pattern)
    │     → append to docs/watchdog/learned-patterns.md
    ├── NEW SUCCESS PATTERN (3+ occurrences of same fast/clean path):
    │     → LLM: "here are N successes, what's the best-practice observation?"
    │     → write to learned_repair_patterns (type=success_pattern)
    │     → append to docs/watchdog/learned-patterns.md
    └── PROMOTED PATTERN (occurrence_count >= 5, promoted_to_code=false):
          → LLM: generate TypeScript repair code
          → patch template-review.ts or prompts.ts
          → set promoted_to_code=true in DB
          → git commit: "fix(agent-X): auto-promote {pattern} repair rule from watchdog"

pipeline exits → WatchdogAgent receives SIGTERM → graceful shutdown
```

---

## Data Model

### `pipeline_run_log`
```sql
id               uuid primary key default gen_random_uuid()
run_id           text not null        -- UUID grouping all steps in one pipeline execution
offer_id         text not null
agent_name       text not null        -- 'agent-0.5', 'agent-1', 'agent-2', 'agent-3'
step             text not null        -- 'hub_page', 'keyword_cluster', 'hugo_templates', etc.
city             text
state            text
status           text not null        -- 'success' | 'failed' | 'recovered' | 'dead'
model_used       text                 -- 'claude' | 'codex' | 'gemini' (for repair calls)
duration_ms      integer not null
error_message    text
fix_applied      text                 -- description of what the LLM changed
retry_count      integer not null default 0
created_at       timestamptz not null default now()
```

### `learned_repair_patterns`
```sql
id               uuid primary key default gen_random_uuid()
pattern_type     text not null        -- 'failure_pattern' | 'success_pattern'
agent_name       text not null
step             text not null
trigger          text not null        -- error signature or condition that identifies the pattern
fix_strategy     text                 -- what fixed it (failure patterns)
best_practice    text                 -- what made it succeed (success patterns)
occurrence_count integer not null default 1
first_seen_at    timestamptz not null
last_seen_at     timestamptz not null
promoted_to_code boolean not null default false
promoted_at      timestamptz
notes            text
```

---

## New Files

```
src/shared/self-healing.ts              inline recovery wrapper
src/agents/agent-watchdog/index.ts      background observer + learner + code promoter
src/shared/db/migrations/XXXX_pipeline_run_log.sql
src/shared/db/migrations/XXXX_learned_repair_patterns.sql
docs/watchdog/learned-patterns.md       auto-maintained by watchdog
```

## Modified Files

```
src/index.ts                            generate run_id, spawn watchdog child process
src/agents/agent-3-builder/index.ts     wrap applyDesignSystem with withSelfHealing
src/agents/agent-1-keywords/index.ts    wrap keyword clustering with withSelfHealing
src/agents/agent-0.5-geo-scanner/index.ts  wrap geo reference refresh with withSelfHealing
```

---

## `withSelfHealing` Interface

```typescript
await withSelfHealing({
  runId: string,
  offerId: string,
  agentName: string,
  step: string,
  city?: string,
  state?: string,
  fn: () => Promise<T>,
  getRepairContext: (error: Error) => string,  // agent provides: error + broken code
  db: DbClient,
  llm: LlmClient,
});
```

`getRepairContext` is the per-agent "brain" — it knows what code to send and how to frame the prompt. Example from Agent 3:

```typescript
getRepairContext: (err) => `
Hugo template validation failed with this error:
${err.message}

Here are the three Hugo templates that caused it:

baseof.html:
${currentTemplates.baseof}

list.html (city_hub):
${currentTemplates.city_hub}

single.html (service_subpage):
${currentTemplates.service_subpage}

Fix the templates so Hugo validation passes. Return only the corrected templates in the same JSON format: { baseof, city_hub, service_subpage }.
`
```

---

## `docs/watchdog/learned-patterns.md` Format

```markdown
# Pipeline Learned Patterns

_Auto-maintained by WatchdogAgent. Last updated: {timestamp}_

---

## Failure Patterns

### [PROMOTED] agent-3 / hugo_templates / nil_slice_first_calls
- **Trigger**: `{{ range first N .Params.X }}` crashes when .Params.X is nil
- **Fix**: Wrap with `(default slice .Params.X)`
- **Promoted to code**: 2026-03-03 in template-review.ts
- **Seen**: 7 times

### [ACTIVE] agent-1 / keyword_cluster / malformed_json_special_chars
- **Trigger**: Haiku returns malformed JSON for cities with special characters in name
- **Fix applied**: Claude strips control characters and re-parses
- **Recovery rate**: 3/3 (100%)
- **Seen**: 3 times — not yet promoted

---

## Success Patterns

### agent-1 / keyword_cluster / haiku_fast_path
- **Observation**: Haiku completes clustering in <20s for cities <100k pop, 94% of runs
- **Recommendation**: Keep haiku for clustering — sonnet adds no quality lift

### agent-3 / hub_page / sonnet_fl_coastal
- **Observation**: Sonnet generates FL coastal city pages with zero quality gate failures
- **Recommendation**: Prioritize sonnet for FL coastal cities
```

---

## What Is Out Of Scope

- Watchdog does not monitor Hugo build output files (only pipeline execution steps)
- Watchdog does not auto-rollback git commits if a promoted rule causes regressions
- Watchdog does not run when the pipeline is not running (no idle background daemon)
- Agent 2 (design research) is not wrapped initially — its steps are deterministic enough to not need it

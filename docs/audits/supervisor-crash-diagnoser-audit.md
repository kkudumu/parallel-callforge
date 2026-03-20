# Audit Prompt: Pipeline Supervisor + Crash Diagnoser

## What Was Built

A supervisor process that wraps the existing `npx tsx src/index.ts pipeline <offerId>` command. It auto-restarts on crash, diagnoses failures via LLM, and feeds patterns to the watchdog's `learned_repair_patterns` table for permanent fixes.

**Command:** `npx tsx src/index.ts supervise <offerId>`

## Files to Audit

| File | Action | Purpose |
|------|--------|---------|
| `src/supervisor.ts` | NEW (~250 lines) | Supervisor process: spawn, diagnose, retry loop |
| `src/index.ts` | MODIFIED (+15 lines) | CLI wiring for `supervise` command |
| `src/shared/db/migrations/015-pipeline-crashes.sql` | NEW (~28 lines) | `pipeline_crashes` table + indexes |

## Architecture

```
npx tsx src/index.ts supervise <offerId>
  └── Supervisor (src/supervisor.ts) — PARENT process, survives crashes
       └── spawn("npx tsx src/index.ts pipeline <offerId>") — CHILD
            ├── Watchdog (existing child of pipeline)
            └── Agents 0.5 → 1 → 2 → 3
```

## Audit Checklist

### 1. Process Isolation & Crash Survival

- [ ] Supervisor spawns pipeline as a **child process** via `child_process.spawn`, NOT in-process try/catch
- [ ] If the child OOMs or gets SIGKILL, the supervisor process survives and can diagnose/retry
- [ ] `stdio` is `["ignore", "pipe", "pipe"]` — stdout/stderr piped through AND captured
- [ ] No shared memory or state between supervisor and child that would corrupt on crash
- [ ] `detached: false` — child doesn't outlive supervisor

### 2. Signal Forwarding

- [ ] SIGINT forwarded from supervisor to active child process
- [ ] SIGTERM forwarded from supervisor to active child process
- [ ] Forwarding only happens when `activeChild` exists and is not killed
- [ ] Pipeline's own cleanup (watchdog stop, DB close) runs when signals are forwarded
- [ ] No signal handler leak — handlers registered once, not per-attempt

### 3. Output Capture & Pass-Through

- [ ] stdout and stderr are piped to terminal in real-time (user sees pipeline output)
- [ ] Rolling buffers capped at 50KB each (`MAX_STDOUT_CAPTURE`, `MAX_STDERR_CAPTURE`)
- [ ] Buffer trimming works correctly — slices from the end, not the beginning
- [ ] No memory leak from unbounded buffer growth across retries
- [ ] Buffers are fresh per attempt (new `spawnPipeline()` call each iteration)

### 4. Retry Logic

- [ ] `MAX_RETRIES = 3` — attempts 1, 2, 3
- [ ] Exponential backoff: 10s, 20s, 40s (`BASE_BACKOFF_MS * 2^(attempt-1)`)
- [ ] Exit code 0 → immediate success return, no unnecessary retries
- [ ] Non-transient + confidence > 0.8 → early exit, don't waste retries
- [ ] Backoff sleep only happens between retries, not after last attempt
- [ ] All retries exhausted → Discord notification + failure return

### 5. LLM Crash Diagnosis

- [ ] Uses **Sonnet** model (not Haiku) — stack trace reasoning needs quality
- [ ] Prompt includes: exit code, signal, duration, memory usage
- [ ] Prompt includes: last 4KB of stderr, last 2KB of stdout
- [ ] Prompt includes: last 20 `pipeline_run_log` entries for this offerId
- [ ] Prompt includes: last 10 `learned_repair_patterns` failure entries
- [ ] Zod schema (`CrashDiagnosisSchema`) validates all required fields
- [ ] `error_category` enum matches exactly with `pipeline_crashes.diagnosis_category` CHECK constraint
- [ ] Diagnosis failure is caught and logged — does NOT prevent retry or crash logging
- [ ] `confidence` is a number 0-1, validated by Zod

### 6. Database: pipeline_crashes Table

- [ ] `id` is UUID with `gen_random_uuid()` default
- [ ] `supervisor_run_id` links all crashes from one supervisor invocation
- [ ] `offer_id` matches the pipeline's offer
- [ ] `attempt` is 1-indexed integer
- [ ] `exit_code` nullable (SIGKILL has no exit code)
- [ ] `signal` nullable (normal exit has no signal)
- [ ] `stdout_tail` and `stderr_tail` stored (truncated to 4KB in INSERT)
- [ ] `duration_ms` is NOT NULL — always measurable
- [ ] `memory_usage_mb` nullable — best effort
- [ ] `crashed_at` is NOT NULL TIMESTAMPTZ
- [ ] `diagnosis_*` fields are all nullable — diagnosis can fail
- [ ] `diagnosis_category` CHECK constraint matches the Zod enum exactly:
  `'oom', 'timeout', 'llm_failure', 'db_failure', 'file_io', 'validation', 'unhandled', 'signal', 'unknown'`
- [ ] `diagnosis_confidence` is `NUMERIC(3,2)` — supports 0.00 to 9.99 (verify 0-1 fits)
- [ ] Indexes on `supervisor_run_id`, `offer_id`, `diagnosis_category`
- [ ] `created_at` default `now()`
- [ ] Migration file sorts after `014-agent3-hybrid-cache.sql`

### 7. learned_repair_patterns Integration

- [ ] UPSERT uses same `(agent_name, step, trigger_condition)` unique constraint as watchdog
- [ ] `pattern_type` is `'failure_pattern'`
- [ ] `step` format is `process_crash:<category>` — distinguishes from in-process failures
- [ ] `trigger_condition` is `diagnosis.pattern_label` — snake_case label
- [ ] `fix_strategy` is `diagnosis.preventive_fix`
- [ ] `notes` is `diagnosis.root_cause`
- [ ] On conflict: increments `occurrence_count`, updates `last_seen_at`, preserves existing fix_strategy if new one is null
- [ ] `parseLastAgent()` correctly maps Step 1-4 to agent-0.5, agent-1, agent-2, agent-3
- [ ] Falls back to `"pipeline"` if no step marker found in stdout
- [ ] Pattern persistence failure is caught — does NOT prevent retry

### 8. Watchdog Compatibility

- [ ] No changes to watchdog code — it already reads `learned_repair_patterns`
- [ ] Supervisor-generated patterns are indistinguishable from watchdog-generated ones (same schema)
- [ ] At 5+ occurrences, watchdog's code promotion logic will pick up supervisor patterns
- [ ] No table schema conflicts between watchdog's UPSERT and supervisor's UPSERT

### 9. Checkpoint Compatibility

- [ ] Supervisor re-runs the exact same command: `npx tsx src/index.ts pipeline <offerId>`
- [ ] Agents already skip completed phases on re-run (checkpoint system)
- [ ] No checkpoint reset or modification by supervisor
- [ ] Re-run after crash resumes from the last incomplete agent

### 10. CLI Wiring (index.ts)

- [ ] Import: `import { runSupervisor } from "./supervisor.js";`
- [ ] `supervise` command branch placed before `orchestrate` and agent handlers
- [ ] Validates `offerId` argument, prints usage on missing
- [ ] Calls `runSupervisor(offerId)` and handles promise result
- [ ] `result.success` → exit 0, `!result.success` → exit 1
- [ ] Catch block for unexpected errors → exit 1
- [ ] Help text includes supervise command description
- [ ] No disruption to existing `pipeline`, `orchestrate`, and agent commands

### 11. Resource Cleanup

- [ ] `db.end()` called in `finally` block of `runSupervisor()`
- [ ] No DB connection leak across retry attempts (single connection for supervisor lifetime)
- [ ] Child process reference cleared after exit (`activeChild = null`)
- [ ] No interval/timer leaks
- [ ] Signal handlers don't prevent process exit

### 12. Edge Cases & Error Handling

- [ ] What happens if `pipeline_run_log` table is empty? (logsContext should be "(none)")
- [ ] What happens if `learned_repair_patterns` table is empty? (patternsContext should be "(none)")
- [ ] What happens if DB is unreachable during diagnosis? (caught, logged, retry continues)
- [ ] What happens if LLM is unreachable? (caught, logged, crash still logged without diagnosis)
- [ ] What happens if child process fails to spawn? (error event handler resolves with exit code 1)
- [ ] What happens if supervisor is killed during backoff sleep? (process exits, no zombie child)
- [ ] What happens if stdout/stderr buffers are empty? (slicing empty string is safe)
- [ ] `NUMERIC(3,2)` allows values up to 9.99 — but confidence is 0-1. Is the column type appropriate? (Works fine, just allows wider range than needed)

### 13. Type Safety

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] `CrashDiagnosis` type is inferred from Zod schema
- [ ] `SupervisorResult` interface is exported and used by index.ts
- [ ] `DbClient` and `LlmClient` types imported correctly
- [ ] No `any` types except in catch blocks (standard pattern)

### 14. Security

- [ ] No secrets logged to stdout/stderr
- [ ] Discord webhook URL from env, not hardcoded
- [ ] stderr/stdout tails truncated before DB storage (4KB limit)
- [ ] No command injection — `offerId` passed as spawn argument, not shell-interpolated
- [ ] `spawn()` uses array args, not shell string

### 15. Performance

- [ ] Supervisor process itself is lightweight — no LLM/DB work until crash occurs
- [ ] Diagnosis only runs on crash, not on success
- [ ] Single DB connection for entire supervisor lifetime
- [ ] Backoff prevents rapid retry loops
- [ ] Buffer cap prevents memory growth from verbose pipeline output

## How to Run the Audit

```bash
# 1. Type check
npx tsc --noEmit

# 2. Verify migration applies cleanly
npx tsx src/index.ts pipeline --help  # triggers migrations

# 3. Check table exists
npx tsx -e "
  require('dotenv').config();
  const { createDbClient } = require('./src/shared/db/client.js');
  const db = createDbClient(process.env.DATABASE_URL);
  db.query('SELECT COUNT(*) FROM pipeline_crashes').then(r => {
    console.log('pipeline_crashes table exists, rows:', r.rows[0].count);
    db.end();
  }).catch(e => { console.error(e.message); db.end(); });
"

# 4. Dry run supervisor
npx tsx src/index.ts supervise pestcontrol-1

# 5. After a crash, verify DB entries
# SELECT * FROM pipeline_crashes ORDER BY created_at DESC LIMIT 5;
# SELECT * FROM learned_repair_patterns WHERE step LIKE 'process_crash:%' ORDER BY last_seen_at DESC;
```

## Known Design Decisions

1. **Sonnet over Haiku for diagnosis** — Stack trace analysis needs reasoning quality; cost is acceptable since it only runs on crash (rare).
2. **Supervisor memory_usage_mb is its own RSS, not the child's** — Child's memory is gone after crash. This is the best available signal.
3. **`parseLastAgent()` is heuristic** — Parses "Step N/4" from stdout to determine which agent was running. Falls back to "pipeline" if unparsable.
4. **No watchdog code changes** — The watchdog already consumes `learned_repair_patterns` via its existing tick. Supervisor-generated patterns flow through naturally.
5. **`NUMERIC(3,2)` for confidence** — Allows 0.00-9.99 which is wider than the 0-1 range. Harmless, and Zod enforces the 0-1 constraint on write.

# Self-Healing Pipeline Watchdog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an always-on self-healing pipeline observer that catches every failure, invokes Claude → Codex → Gemini to fix it in-place, and runs a background watchdog that learns patterns from every run (success and failure), writes them to DB + markdown, and promotes recurring fixes back into the TypeScript source.

**Architecture:** `withSelfHealing()` wraps risky agent steps — on failure it snapshots state, calls the LLM fallback chain with the error + broken code, applies the fix, and retries up to 3 times. A `WatchdogAgent` child process runs for the life of the pipeline, polls `pipeline_run_log` every 60s, clusters patterns, and promotes mature patterns into source code via git commit.

**Tech Stack:** TypeScript, PostgreSQL (pg), Node.js `child_process.spawn`, `node:crypto` for run_id, existing `LlmClient` (Claude → Codex → Gemini already wired), Zod v4

---

## Context: Key Files To Know

Before starting, read these:
- `src/shared/cli/llm-client.ts` — `LlmClient.call()` requires a Zod schema; repair calls use `z.object({ fixed_code: z.string(), summary: z.string() })`
- `src/shared/checkpoints.ts` — pattern for DB-backed state; follow same style
- `src/shared/db/migrations/009-agent-checkpoints.sql` — follow this migration style exactly
- `src/agents/agent-3-builder/index.ts:1838-1843` — current Hugo validation that throws; this is Task 4's wrap target
- `src/agents/agent-1-keywords/index.ts:664` — `runAgent1` entry point; Task 5's wrap target
- `src/agents/agent-0.5-geo-scanner/index.ts:1091` — `runAgent05`; Task 6's wrap target
- `src/index.ts:314-372` — `runPipeline()`; Task 3 adds `run_id` generation and watchdog spawn here

---

## Task 1: DB Migrations

**Files:**
- Create: `src/shared/db/migrations/012-pipeline-run-log.sql`
- Create: `src/shared/db/migrations/013-learned-repair-patterns.sql`

**Step 1: Write migration 012**

```sql
-- src/shared/db/migrations/012-pipeline-run-log.sql
CREATE TABLE IF NOT EXISTS pipeline_run_log (
  id               uuid primary key default gen_random_uuid(),
  run_id           text not null,
  offer_id         text not null,
  agent_name       text not null,
  step             text not null,
  city             text,
  state            text,
  status           text not null check (status in ('success','failed','recovered','dead')),
  model_used       text,
  duration_ms      integer not null,
  error_message    text,
  fix_applied      text,
  retry_count      integer not null default 0,
  created_at       timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS pipeline_run_log_run_id_idx ON pipeline_run_log (run_id);
CREATE INDEX IF NOT EXISTS pipeline_run_log_agent_step_idx ON pipeline_run_log (agent_name, step);
CREATE INDEX IF NOT EXISTS pipeline_run_log_status_idx ON pipeline_run_log (status);
```

**Step 2: Write migration 013**

```sql
-- src/shared/db/migrations/013-learned-repair-patterns.sql
CREATE TABLE IF NOT EXISTS learned_repair_patterns (
  id               uuid primary key default gen_random_uuid(),
  pattern_type     text not null check (pattern_type in ('failure_pattern','success_pattern')),
  agent_name       text not null,
  step             text not null,
  trigger          text not null,
  fix_strategy     text,
  best_practice    text,
  occurrence_count integer not null default 1,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  promoted_to_code boolean not null default false,
  promoted_at      timestamptz,
  notes            text,
  UNIQUE (agent_name, step, trigger)
);
```

**Step 3: Run migrations to verify SQL is valid**

```bash
npx tsx src/index.ts agent-0.5 pestcontrol-1 2>&1 | head -5
# Should print "Migrations complete." with no errors
```

**Step 4: Commit**

```bash
git add src/shared/db/migrations/012-pipeline-run-log.sql src/shared/db/migrations/013-learned-repair-patterns.sql
git commit -m "feat(db): add pipeline_run_log and learned_repair_patterns tables"
```

---

## Task 2: `withSelfHealing()` Wrapper

**Files:**
- Create: `src/shared/self-healing.ts`
- Create: `src/shared/self-healing.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/shared/self-healing.test.ts
import { withSelfHealing } from "./self-healing.js";
import type { DbClient } from "./db/client.js";
import type { LlmClient } from "./cli/llm-client.js";

function makeMockDb(rows: unknown[] = []): DbClient {
  return {
    query: jest.fn().mockResolvedValue({ rows }),
    end: jest.fn(),
  } as unknown as DbClient;
}

function makeMockLlm(fixedCode = "fixed"): LlmClient {
  return {
    call: jest.fn().mockResolvedValue({ fixed_code: fixedCode, summary: "patched it" }),
  } as unknown as LlmClient;
}

describe("withSelfHealing", () => {
  it("returns fn result on success without touching llm", async () => {
    const db = makeMockDb();
    const llm = makeMockLlm();
    const fn = jest.fn().mockResolvedValue("ok");

    const result = await withSelfHealing({
      runId: "run-1", offerId: "offer-1",
      agentName: "agent-3", step: "hugo_templates",
      fn,
      getRepairContext: () => "context",
      applyFix: async () => {},
      db, llm,
    });

    expect(result).toBe("ok");
    expect(llm.call).not.toHaveBeenCalled();
  });

  it("logs success to pipeline_run_log", async () => {
    const db = makeMockDb();
    const llm = makeMockLlm();
    const fn = jest.fn().mockResolvedValue("ok");

    await withSelfHealing({
      runId: "run-1", offerId: "offer-1",
      agentName: "agent-3", step: "hugo_templates",
      fn, getRepairContext: () => "", applyFix: async () => {}, db, llm,
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO pipeline_run_log"),
      expect.arrayContaining(["run-1", "success"])
    );
  });

  it("invokes llm and retries on failure, logs recovered", async () => {
    const db = makeMockDb();
    const llm = makeMockLlm("fixed");
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw new Error("Hugo validation failed");
      return "ok";
    });
    const applyFix = jest.fn().mockResolvedValue(undefined);

    const result = await withSelfHealing({
      runId: "run-1", offerId: "offer-1",
      agentName: "agent-3", step: "hugo_templates",
      fn, getRepairContext: (e) => `fix this: ${e.message}`, applyFix, db, llm,
    });

    expect(result).toBe("ok");
    expect(applyFix).toHaveBeenCalledWith("fixed", 1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO pipeline_run_log"),
      expect.arrayContaining(["run-1", "recovered"])
    );
  });

  it("restores snapshot and logs dead after 3 failures", async () => {
    const db = makeMockDb();
    const llm = makeMockLlm("fixed");
    const fn = jest.fn().mockRejectedValue(new Error("always fails"));
    const snapshot = { data: "original" };
    const takeSnapshot = jest.fn().mockResolvedValue(snapshot);
    const restoreSnapshot = jest.fn().mockResolvedValue(undefined);
    const applyFix = jest.fn().mockResolvedValue(undefined);

    await expect(withSelfHealing({
      runId: "run-1", offerId: "offer-1",
      agentName: "agent-3", step: "hugo_templates",
      fn, getRepairContext: () => "ctx", applyFix,
      takeSnapshot, restoreSnapshot,
      db, llm, maxRetries: 3,
    })).rejects.toThrow("always fails");

    expect(restoreSnapshot).toHaveBeenCalledWith(snapshot);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO pipeline_run_log"),
      expect.arrayContaining(["run-1", "dead"])
    );
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
npx jest src/shared/self-healing.test.ts --no-coverage 2>&1 | tail -10
# Expected: FAIL — "Cannot find module './self-healing.js'"
```

**Step 3: Implement `src/shared/self-healing.ts`**

```typescript
import { z } from "zod/v4";
import type { DbClient } from "./db/client.js";
import type { LlmClient } from "./cli/llm-client.js";

const RepairResponseSchema = z.object({
  fixed_code: z.string(),
  summary: z.string(),
});

export interface SelfHealingOptions<T> {
  runId: string;
  offerId: string;
  agentName: string;
  step: string;
  city?: string;
  state?: string;
  fn: () => Promise<T>;
  getRepairContext: (error: Error) => string;
  applyFix: (fixedCode: string, attempt: number) => Promise<void>;
  takeSnapshot?: () => Promise<unknown>;
  restoreSnapshot?: (snapshot: unknown) => Promise<void>;
  db: DbClient;
  llm: LlmClient;
  maxRetries?: number;
}

async function logRun(
  db: DbClient,
  entry: {
    runId: string; offerId: string; agentName: string; step: string;
    city?: string; state?: string; status: string; modelUsed?: string;
    durationMs: number; errorMessage?: string; fixApplied?: string; retryCount: number;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO pipeline_run_log
     (run_id, offer_id, agent_name, step, city, state, status, model_used,
      duration_ms, error_message, fix_applied, retry_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      entry.runId, entry.offerId, entry.agentName, entry.step,
      entry.city ?? null, entry.state ?? null, entry.status,
      entry.modelUsed ?? null, entry.durationMs,
      entry.errorMessage ?? null, entry.fixApplied ?? null, entry.retryCount,
    ]
  );
}

export async function withSelfHealing<T>(opts: SelfHealingOptions<T>): Promise<T> {
  const {
    runId, offerId, agentName, step, city, state,
    fn, getRepairContext, applyFix,
    takeSnapshot, restoreSnapshot,
    db, llm, maxRetries = 3,
  } = opts;

  const snapshot = takeSnapshot ? await takeSnapshot() : undefined;
  const startedAt = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      await logRun(db, {
        runId, offerId, agentName, step, city, state,
        status: attempt === 0 ? "success" : "recovered",
        durationMs: Date.now() - startedAt,
        retryCount: attempt,
        fixApplied: attempt > 0 ? `Recovered after ${attempt} attempt(s)` : undefined,
      });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (attempt >= maxRetries) {
        if (restoreSnapshot && snapshot !== undefined) {
          await restoreSnapshot(snapshot);
        }
        await logRun(db, {
          runId, offerId, agentName, step, city, state,
          status: "dead",
          durationMs: Date.now() - startedAt,
          errorMessage: error.message,
          retryCount: attempt,
        });
        throw error;
      }

      // Log the failure before attempting repair
      await logRun(db, {
        runId, offerId, agentName, step, city, state,
        status: "failed",
        durationMs: Date.now() - startedAt,
        errorMessage: error.message,
        retryCount: attempt,
      });

      // Invoke LLM repair chain (Claude → Codex → Gemini via existing fallback)
      const repairContext = getRepairContext(error);
      const repairPrompt = `${repairContext}\n\nReturn JSON with two fields:\n- fixed_code: the corrected code as a string\n- summary: one sentence describing what was wrong and what you changed`;

      const repair = await llm.call({
        prompt: repairPrompt,
        schema: RepairResponseSchema,
        model: "sonnet",
        logLabel: `[SelfHealing][${agentName}][${step}]`,
      });

      await applyFix(repair.fixed_code, attempt + 1);
    }
  }

  throw new Error("Unreachable");
}
```

**Step 4: Run tests to confirm they pass**

```bash
npx jest src/shared/self-healing.test.ts --no-coverage 2>&1 | tail -10
# Expected: PASS — 4 tests
```

**Step 5: Commit**

```bash
git add src/shared/self-healing.ts src/shared/self-healing.test.ts
git commit -m "feat(shared): add withSelfHealing inline recovery wrapper"
```

---

## Task 3: Wire `run_id` Into Pipeline + Spawn Watchdog

**Files:**
- Modify: `src/index.ts`

**Step 1: Add `run_id` generation and watchdog spawn to `runPipeline()`**

In `src/index.ts`, find `async function runPipeline()`. Add at the top of the function body, after the `db` and `llm` setup but before `runMigrations`:

```typescript
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
```

Then inside `runPipeline()`, after `await runMigrations(...)`:

```typescript
const runId = randomUUID();
console.log(`[Pipeline] Run ID: ${runId}`);

// Spawn watchdog as a child process — lives for the duration of this pipeline run
const watchdogProcess = spawn(
  process.execPath,
  ["--require", process.argv[1].replace("index.ts", "node_modules/tsx/dist/preflight.cjs"),
   "--import", `file://${process.argv[1].replace("index.ts", "node_modules/tsx/dist/loader.mjs")}`,
   "src/agents/agent-watchdog/index.ts"],
  {
    env: { ...process.env },
    stdio: ["ignore", "inherit", "inherit"],
    cwd: process.cwd(),
  }
);
watchdogProcess.on("error", (err) => {
  console.warn(`[Watchdog] Failed to start: ${err.message}`);
});
console.log(`[Pipeline] Watchdog started (PID ${watchdogProcess.pid})`);
```

Then at the end of `runPipeline()`, before `await db.end()`, add:

```typescript
watchdogProcess.kill("SIGTERM");
console.log("[Pipeline] Watchdog stopped");
```

Pass `runId` through to each agent call as a parameter (you will use it in Tasks 4-6). For now just thread it through — `runId` will be an optional param on the wrapped calls.

**Step 2: Verify pipeline still boots**

```bash
cd /root/general-projects/parallel-callforge && timeout 15 npx tsx src/index.ts pipeline pestcontrol-1 2>&1 | head -20
# Should see: "[Pipeline] Run ID: <uuid>" and "[Pipeline] Watchdog started (PID ...)"
# Will fail on missing watchdog file — that's expected and OK for now
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(pipeline): generate run_id and spawn watchdog child process"
```

---

## Task 4: Wrap Agent 3 Hugo Template Validation

**Files:**
- Modify: `src/agents/agent-3-builder/index.ts`

**Step 1: Find the exact throw location**

Open `src/agents/agent-3-builder/index.ts` at line 1838. You will see:

```typescript
console.log("[Agent 3][Design system][Template review] Running Hugo template validation...");
const templateValidation = await hugo.validateSite();
if (!templateValidation.success) {
  throw new Error(`Generated Hugo templates failed validation: ${templateValidation.output}`);
}
```

This is inside `applyDesignSystem()`. The fix wraps this validation + retry in `withSelfHealing`.

**Step 2: Add `runId` parameter to `applyDesignSystem` and `runAgent3`**

In `Agent3Config` interface, add:
```typescript
runId?: string;
```

In `applyDesignSystem` signature, add `runId: string` parameter. In `runAgent3`, pass `cfg.runId ?? "no-run-id"` through.

**Step 3: Replace the bare throw with `withSelfHealing`**

Replace the validation block with:

```typescript
import { withSelfHealing } from "../../shared/self-healing.js";

// Inside applyDesignSystem, replace the validation throw block:
let finalTemplates = reviewedTemplateResult.templates;

await withSelfHealing({
  runId,
  offerId: "unknown", // applyDesignSystem doesn't receive offerId — pass from caller if needed
  agentName: "agent-3",
  step: "hugo_templates",
  fn: async () => {
    const validation = await hugo.validateSite();
    if (!validation.success) {
      throw new Error(`Generated Hugo templates failed validation: ${validation.output}`);
    }
  },
  getRepairContext: (err) => `
Hugo template validation failed with this error:
${err.message}

Here are the three Hugo templates that caused it.
Fix them so Hugo validation passes.
Return JSON: { "fixed_code": "<JSON string of {baseof, city_hub, service_subpage}>", "summary": "what you fixed" }

baseof.html:
${finalTemplates.baseof}

list.html (city_hub):
${finalTemplates.city_hub}

single.html (service_subpage):
${finalTemplates.service_subpage}
`,
  applyFix: async (fixedCode) => {
    const parsed = JSON.parse(fixedCode) as { baseof: string; city_hub: string; service_subpage: string };
    finalTemplates = parsed;
    hugo.writeTemplate("_default/baseof.html", parsed.baseof);
    hugo.writeTemplate("_default/list.html", parsed.city_hub);
    hugo.writeTemplate("_default/single.html", parsed.service_subpage);
    // Clear template cache so next pipeline run regenerates
    await db.query("DELETE FROM hugo_template_cache WHERE niche = $1", [normalizeNiche(niche)]);
  },
  takeSnapshot: async () => ({
    baseof: finalTemplates.baseof,
    city_hub: finalTemplates.city_hub,
    service_subpage: finalTemplates.service_subpage,
  }),
  restoreSnapshot: async (snap) => {
    const s = snap as { baseof: string; city_hub: string; service_subpage: string };
    hugo.writeTemplate("_default/baseof.html", s.baseof);
    hugo.writeTemplate("_default/list.html", s.city_hub);
    hugo.writeTemplate("_default/single.html", s.service_subpage);
  },
  db,
  llm,
});

console.log("[Agent 3][Design system][Template review] Hugo template validation passed");
```

**Step 4: Run the existing quality-gate tests to confirm nothing broke**

```bash
npx jest src/agents/agent-3-builder/quality-gate.test.ts --no-coverage 2>&1 | tail -10
# Expected: PASS
```

**Step 5: Commit**

```bash
git add src/agents/agent-3-builder/index.ts
git commit -m "feat(agent-3): wrap Hugo template validation with withSelfHealing"
```

---

## Task 5: Wrap Agent 1 Keyword Clustering

**Files:**
- Modify: `src/agents/agent-1-keywords/index.ts`

**Step 1: Add `runId` to `Agent1Config`**

In the config type near line 664, add:
```typescript
runId?: string;
```

**Step 2: Find keyword clustering LLM call**

Search for `Step 5: Clustering` or `[Step 5][` in `index.ts`. That's the LLM call that can produce malformed JSON. Wrap the clustering call:

```typescript
await withSelfHealing({
  runId: cfg.runId ?? "no-run-id",
  offerId: cfg.offerId ?? "unknown",
  agentName: "agent-1",
  step: "keyword_cluster",
  city: candidate.city,
  state: candidate.state,
  fn: () => runClusteringLlmCall(candidate, cfg, llm), // extract existing call into fn
  getRepairContext: (err) => `
Keyword clustering for ${candidate.city}, ${candidate.state} failed:
${err.message}

The clustering prompt was:
${clusteringPrompt}

Fix the JSON so it's valid and matches the required schema.
Return JSON: { "fixed_code": "<valid JSON string>", "summary": "what was wrong" }
`,
  applyFix: async (fixedCode) => {
    // Parse the fixed JSON and store it so fn() can use it on retry
    parsedClusters = JSON.parse(fixedCode);
  },
  db,
  llm,
});
```

Note: exact variable names will differ from what's in the file — read the actual clustering code first and adapt.

**Step 3: Run agent-1 tests**

```bash
npx jest src/agents/agent-1-keywords/agent-1.test.ts --no-coverage 2>&1 | tail -10
# Expected: PASS
```

**Step 4: Commit**

```bash
git add src/agents/agent-1-keywords/index.ts
git commit -m "feat(agent-1): wrap keyword clustering with withSelfHealing"
```

---

## Task 6: Wrap Agent 0.5 Geo Reference Refresh

**Files:**
- Modify: `src/agents/agent-0.5-geo-scanner/index.ts`

**Step 1: Add `runId` to `Agent05Config`**

```typescript
// In Agent05Config interface:
runId?: string;
```

**Step 2: Find `maybeRefreshGeoReference` call**

Around line 1208 in `runAgent05`. Wrap it:

```typescript
await withSelfHealing({
  runId: config.runId ?? "no-run-id",
  offerId,
  agentName: "agent-0.5",
  step: "geo_reference_refresh",
  fn: () => importGeoZipReferenceIntoDb(db),
  getRepairContext: (err) => `
Geo ZIP reference import failed:
${err.message}

The importer is at src/shared/db/import-geo-zip-reference.ts.
Diagnose the failure and return a fix.
Return JSON: { "fixed_code": "description of what to do", "summary": "root cause" }
`,
  applyFix: async (fixedCode) => {
    console.warn(`[Agent 0.5][SelfHealing] LLM repair suggestion: ${fixedCode}`);
    // Geo reference fixes are usually data issues — log and let retry handle it
  },
  db,
  llm,
});
```

**Step 3: Run agent-0.5 tests**

```bash
npx jest src/agents/agent-0.5-geo-scanner/agent-0.5.test.ts --no-coverage 2>&1 | tail -10
# Expected: PASS
```

**Step 4: Commit**

```bash
git add src/agents/agent-0.5-geo-scanner/index.ts
git commit -m "feat(agent-0.5): wrap geo reference refresh with withSelfHealing"
```

---

## Task 7: WatchdogAgent — Poll Loop + Pattern Clustering

**Files:**
- Create: `src/agents/agent-watchdog/index.ts`

**Step 1: Write the failing test**

```typescript
// src/agents/agent-watchdog/index.test.ts
import { clusterFailurePatterns, clusterSuccessPatterns } from "./index.js";

const mockRows = [
  { agent_name: "agent-3", step: "hugo_templates", status: "failed",
    error_message: "partial schema.json not found", duration_ms: 100, model_used: null },
  { agent_name: "agent-3", step: "hugo_templates", status: "failed",
    error_message: "partial schema.json not found", duration_ms: 120, model_used: null },
  { agent_name: "agent-3", step: "hugo_templates", status: "failed",
    error_message: "partial schema.html not found", duration_ms: 110, model_used: null },
];

describe("clusterFailurePatterns", () => {
  it("groups by agent+step+error signature", () => {
    const clusters = clusterFailurePatterns(mockRows as any);
    expect(clusters).toHaveLength(1); // "partial * not found" should cluster together
    expect(clusters[0].occurrenceCount).toBe(3);
    expect(clusters[0].agentName).toBe("agent-3");
    expect(clusters[0].step).toBe("hugo_templates");
  });
});

const successRows = [
  { agent_name: "agent-1", step: "keyword_cluster", status: "success", duration_ms: 15000, model_used: "claude", city: "Lenexa", state: "KS" },
  { agent_name: "agent-1", step: "keyword_cluster", status: "success", duration_ms: 18000, model_used: "claude", city: "Shawnee", state: "KS" },
  { agent_name: "agent-1", step: "keyword_cluster", status: "success", duration_ms: 14000, model_used: "claude", city: "Deland", state: "FL" },
];

describe("clusterSuccessPatterns", () => {
  it("groups consistent fast paths by agent+step+model", () => {
    const clusters = clusterSuccessPatterns(successRows as any);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].occurrenceCount).toBe(3);
    expect(clusters[0].avgDurationMs).toBeLessThan(20000);
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx jest src/agents/agent-watchdog/index.test.ts --no-coverage 2>&1 | tail -5
# Expected: FAIL — "Cannot find module"
```

**Step 3: Implement `src/agents/agent-watchdog/index.ts`**

```typescript
import { randomUUID } from "node:crypto";
import type { DbClient } from "../../shared/db/client.js";

export interface RunLogRow {
  agent_name: string;
  step: string;
  status: string;
  error_message: string | null;
  duration_ms: number;
  model_used: string | null;
  city?: string | null;
  state?: string | null;
}

export interface FailureCluster {
  agentName: string;
  step: string;
  errorSignature: string;
  occurrenceCount: number;
  sampleMessages: string[];
}

export interface SuccessCluster {
  agentName: string;
  step: string;
  modelUsed: string;
  occurrenceCount: number;
  avgDurationMs: number;
}

function extractErrorSignature(message: string): string {
  // Normalize variable parts so similar errors cluster together
  return message
    .replace(/"[^"]+"/g, '"*"')         // quoted strings → "*"
    .replace(/\b\d+\b/g, "N")           // numbers → N
    .replace(/[A-Z]:[/\\][^\s]+/g, "PATH") // file paths → PATH
    .slice(0, 120);
}

export function clusterFailurePatterns(rows: RunLogRow[]): FailureCluster[] {
  const failed = rows.filter((r) => r.status === "failed" || r.status === "dead");
  const groups = new Map<string, RunLogRow[]>();

  for (const row of failed) {
    if (!row.error_message) continue;
    const sig = extractErrorSignature(row.error_message);
    const key = `${row.agent_name}|${row.step}|${sig}`;
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  return [...groups.entries()]
    .filter(([, g]) => g.length >= 2)
    .map(([key, g]) => {
      const [agentName, step, errorSignature] = key.split("|");
      return {
        agentName,
        step,
        errorSignature,
        occurrenceCount: g.length,
        sampleMessages: [...new Set(g.map((r) => r.error_message!))].slice(0, 3),
      };
    });
}

export function clusterSuccessPatterns(rows: RunLogRow[]): SuccessCluster[] {
  const successes = rows.filter((r) => r.status === "success");
  const groups = new Map<string, RunLogRow[]>();

  for (const row of successes) {
    const key = `${row.agent_name}|${row.step}|${row.model_used ?? "unknown"}`;
    const existing = groups.get(key) ?? [];
    existing.push(row);
    groups.set(key, existing);
  }

  return [...groups.entries()]
    .filter(([, g]) => g.length >= 3)
    .map(([key, g]) => {
      const [agentName, step, modelUsed] = key.split("|");
      const avgDurationMs = Math.round(g.reduce((s, r) => s + r.duration_ms, 0) / g.length);
      return { agentName, step, modelUsed, occurrenceCount: g.length, avgDurationMs };
    });
}

async function fetchUnanalyzedRows(db: DbClient): Promise<RunLogRow[]> {
  const result = await db.query<RunLogRow>(
    `SELECT agent_name, step, status, error_message, duration_ms, model_used, city, state
     FROM pipeline_run_log
     WHERE created_at > now() - interval '7 days'
     ORDER BY created_at DESC
     LIMIT 500`
  );
  return result.rows;
}

export async function runWatchdogTick(db: DbClient): Promise<void> {
  const rows = await fetchUnanalyzedRows(db);
  if (rows.length === 0) return;

  const failureClusters = clusterFailurePatterns(rows);
  const successClusters = clusterSuccessPatterns(rows);

  for (const cluster of failureClusters) {
    await db.query(
      `INSERT INTO learned_repair_patterns
       (pattern_type, agent_name, step, trigger, occurrence_count, first_seen_at, last_seen_at)
       VALUES ('failure_pattern', $1, $2, $3, $4, now(), now())
       ON CONFLICT (agent_name, step, trigger) DO UPDATE SET
         occurrence_count = EXCLUDED.occurrence_count,
         last_seen_at = now()`,
      [cluster.agentName, cluster.step, cluster.errorSignature, cluster.occurrenceCount]
    );
  }

  for (const cluster of successClusters) {
    const trigger = `${cluster.modelUsed}_${cluster.avgDurationMs}ms_avg`;
    await db.query(
      `INSERT INTO learned_repair_patterns
       (pattern_type, agent_name, step, trigger, best_practice, occurrence_count, first_seen_at, last_seen_at)
       VALUES ('success_pattern', $1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (agent_name, step, trigger) DO UPDATE SET
         occurrence_count = EXCLUDED.occurrence_count,
         last_seen_at = now()`,
      [
        cluster.agentName, cluster.step, trigger,
        `${cluster.modelUsed} averages ${cluster.avgDurationMs}ms for this step`,
        cluster.occurrenceCount,
      ]
    );
  }
}
```

**Step 4: Run tests to confirm they pass**

```bash
npx jest src/agents/agent-watchdog/index.test.ts --no-coverage 2>&1 | tail -10
# Expected: PASS
```

**Step 5: Commit**

```bash
git add src/agents/agent-watchdog/index.ts src/agents/agent-watchdog/index.test.ts
git commit -m "feat(watchdog): add pattern clustering and poll tick logic"
```

---

## Task 8: WatchdogAgent — LLM Analysis + Markdown + Main Loop

**Files:**
- Modify: `src/agents/agent-watchdog/index.ts`
- Create: `docs/watchdog/learned-patterns.md`

**Step 1: Create the initial markdown file**

```bash
mkdir -p docs/watchdog
cat > docs/watchdog/learned-patterns.md << 'EOF'
# Pipeline Learned Patterns

_Auto-maintained by WatchdogAgent. Do not edit manually._

---

## Failure Patterns

_None recorded yet._

---

## Success Patterns

_None recorded yet._
EOF
```

**Step 2: Add LLM analysis + markdown append to `src/agents/agent-watchdog/index.ts`**

Add these imports at top:
```typescript
import fs from "node:fs";
import path from "node:path";
import { z } from "zod/v4";
import type { LlmClient } from "../../shared/cli/llm-client.js";
```

Add these functions after `runWatchdogTick`:

```typescript
const PatternAnalysisSchema = z.object({
  root_cause: z.string(),
  permanent_fix: z.string(),
  pattern_label: z.string(),
});

const SuccessAnalysisSchema = z.object({
  observation: z.string(),
  recommendation: z.string(),
  pattern_label: z.string(),
});

async function analyzeFailurePattern(
  cluster: FailureCluster,
  llm: LlmClient
): Promise<z.infer<typeof PatternAnalysisSchema>> {
  return llm.call({
    prompt: `A recurring failure pattern was detected in a TypeScript pipeline:

Agent: ${cluster.agentName}
Step: ${cluster.step}
Occurrences: ${cluster.occurrenceCount}
Error samples:
${cluster.sampleMessages.map((m, i) => `${i + 1}. ${m}`).join("\n")}

Provide:
- root_cause: what is causing this failure
- permanent_fix: how to permanently fix it in code
- pattern_label: a short snake_case label (e.g. nil_slice_first_calls)`,
    schema: PatternAnalysisSchema,
    model: "haiku",
    logLabel: "[Watchdog][FailureAnalysis]",
  });
}

async function analyzeSuccessPattern(
  cluster: SuccessCluster,
  llm: LlmClient
): Promise<z.infer<typeof SuccessAnalysisSchema>> {
  return llm.call({
    prompt: `A consistent success pattern was detected in a TypeScript pipeline:

Agent: ${cluster.agentName}
Step: ${cluster.step}
Model: ${cluster.modelUsed}
Occurrences: ${cluster.occurrenceCount}
Average duration: ${cluster.avgDurationMs}ms

Provide:
- observation: what this pattern tells us
- recommendation: how to leverage this going forward
- pattern_label: a short snake_case label`,
    schema: SuccessAnalysisSchema,
    model: "haiku",
    logLabel: "[Watchdog][SuccessAnalysis]",
  });
}

const PATTERNS_MD = path.resolve("docs/watchdog/learned-patterns.md");

function appendToMarkdown(section: "Failure Patterns" | "Success Patterns", entry: string): void {
  let content = fs.existsSync(PATTERNS_MD) ? fs.readFileSync(PATTERNS_MD, "utf-8") : "";
  const marker = `## ${section}`;
  const noneMarker = "_None recorded yet._";
  if (content.includes(`${marker}\n\n${noneMarker}`)) {
    content = content.replace(`${marker}\n\n${noneMarker}`, `${marker}\n\n${entry}`);
  } else if (content.includes(marker)) {
    content = content.replace(marker, `${marker}\n\n${entry}\n`);
  } else {
    content += `\n## ${section}\n\n${entry}\n`;
  }
  content = content.replace(
    /_Auto-maintained by WatchdogAgent.*$/m,
    `_Auto-maintained by WatchdogAgent. Last updated: ${new Date().toISOString()}_`
  );
  fs.writeFileSync(PATTERNS_MD, content, "utf-8");
}

export async function runWatchdogTickWithLlm(db: DbClient, llm: LlmClient): Promise<void> {
  await runWatchdogTick(db);

  // Fetch new unanalyzed failure patterns (no fix_strategy yet, 2+ occurrences)
  const newFailures = await db.query<{
    id: string; agent_name: string; step: string;
    trigger: string; occurrence_count: number;
  }>(
    `SELECT id, agent_name, step, trigger, occurrence_count
     FROM learned_repair_patterns
     WHERE pattern_type = 'failure_pattern'
       AND fix_strategy IS NULL
       AND occurrence_count >= 2`
  );

  for (const row of newFailures.rows) {
    try {
      const analysis = await analyzeFailurePattern(
        { agentName: row.agent_name, step: row.step, errorSignature: row.trigger,
          occurrenceCount: row.occurrence_count, sampleMessages: [row.trigger] },
        llm
      );
      await db.query(
        `UPDATE learned_repair_patterns SET fix_strategy = $1, notes = $2 WHERE id = $3`,
        [analysis.permanent_fix, analysis.root_cause, row.id]
      );
      appendToMarkdown("Failure Patterns",
        `### [ACTIVE] ${row.agent_name} / ${row.step} / ${analysis.pattern_label}\n` +
        `- **Trigger**: ${row.trigger}\n` +
        `- **Root cause**: ${analysis.root_cause}\n` +
        `- **Fix**: ${analysis.permanent_fix}\n` +
        `- **Seen**: ${row.occurrence_count} times\n`
      );
      console.log(`[Watchdog] Analyzed failure pattern: ${row.agent_name}/${row.step}/${analysis.pattern_label}`);
    } catch (err) {
      console.warn(`[Watchdog] Failed to analyze pattern ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Fetch new success patterns with no best_practice analysis yet
  const newSuccesses = await db.query<{
    id: string; agent_name: string; step: string;
    trigger: string; occurrence_count: number;
  }>(
    `SELECT id, agent_name, step, trigger, occurrence_count
     FROM learned_repair_patterns
     WHERE pattern_type = 'success_pattern'
       AND best_practice IS NULL
       AND occurrence_count >= 3`
  );

  for (const row of newSuccesses.rows) {
    try {
      const parts = row.trigger.split("_");
      const model = parts[0] ?? "unknown";
      const avgMs = parseInt(parts[1] ?? "0", 10);
      const analysis = await analyzeSuccessPattern(
        { agentName: row.agent_name, step: row.step, modelUsed: model,
          occurrenceCount: row.occurrence_count, avgDurationMs: avgMs },
        llm
      );
      await db.query(
        `UPDATE learned_repair_patterns SET best_practice = $1 WHERE id = $2`,
        [analysis.observation, row.id]
      );
      appendToMarkdown("Success Patterns",
        `### ${row.agent_name} / ${row.step} / ${analysis.pattern_label}\n` +
        `- **Observation**: ${analysis.observation}\n` +
        `- **Recommendation**: ${analysis.recommendation}\n` +
        `- **Seen**: ${row.occurrence_count} times\n`
      );
    } catch (err) {
      console.warn(`[Watchdog] Failed to analyze success pattern ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
```

**Step 3: Add the main process entry point at bottom of `index.ts`**

```typescript
// Main entry — runs when spawned as a child process
if (process.argv[1]?.includes("agent-watchdog")) {
  (async () => {
    const { createDbClient } = await import("../../shared/db/client.js");
    const { createRateLimiters } = await import("../../shared/cli/rate-limiter.js");
    const { createClaudeCli } = await import("../../shared/cli/claude-cli.js");
    const { createCodexCli } = await import("../../shared/cli/codex-cli.js");
    const { createGeminiCli } = await import("../../shared/cli/gemini-cli.js");
    const { createLlmClient } = await import("../../shared/cli/llm-client.js");
    const { getEnv } = await import("../../config/env.js");

    const env = getEnv();
    const db = createDbClient(env.DATABASE_URL);
    const limiters = createRateLimiters();
    const llm = createLlmClient(
      createClaudeCli(env.CLAUDE_CLI_PATH),
      createCodexCli(env.CODEX_CLI_PATH),
      limiters,
      createGeminiCli(env.GEMINI_CLI_PATH)
    );

    console.log("[Watchdog] Started — polling every 60s");
    const interval = setInterval(async () => {
      try {
        await runWatchdogTickWithLlm(db, llm);
      } catch (err) {
        console.warn(`[Watchdog] Tick error: ${err instanceof Error ? err.message : err}`);
      }
    }, 60_000);

    process.on("SIGTERM", async () => {
      console.log("[Watchdog] Shutting down...");
      clearInterval(interval);
      await db.end();
      process.exit(0);
    });
  })();
}
```

**Step 4: Run tests**

```bash
npx jest src/agents/agent-watchdog/ --no-coverage 2>&1 | tail -10
# Expected: PASS
```

**Step 5: Commit**

```bash
git add src/agents/agent-watchdog/index.ts docs/watchdog/learned-patterns.md
git commit -m "feat(watchdog): add LLM pattern analysis, markdown logging, and main poll loop"
```

---

## Task 9: Code Promotion (Watchdog Patches Source + Commits)

**Files:**
- Modify: `src/agents/agent-watchdog/index.ts`

**Step 1: Add `promotePatternToCode` function**

Add to `index.ts`:

```typescript
import { execSync } from "node:child_process";

const PromotionSchema = z.object({
  file_path: z.string(),
  search_string: z.string(),
  replacement_string: z.string(),
  explanation: z.string(),
});

async function promotePatternToCode(
  patternId: string,
  agentName: string,
  step: string,
  fixStrategy: string,
  trigger: string,
  db: DbClient,
  llm: LlmClient
): Promise<void> {
  const targetFile =
    agentName === "agent-3" && step === "hugo_templates"
      ? "src/agents/agent-3-builder/template-review.ts"
      : agentName === "agent-3"
        ? "src/agents/agent-3-builder/prompts.ts"
        : agentName === "agent-1"
          ? "src/agents/agent-1-keywords/prompts.ts"
          : null;

  if (!targetFile) {
    console.warn(`[Watchdog] No promotion target for ${agentName}/${step} — skipping`);
    return;
  }

  const currentSource = fs.readFileSync(path.resolve(targetFile), "utf-8");

  const promotion = await llm.call({
    prompt: `You are patching a TypeScript source file to permanently fix a recurring pipeline bug.

File: ${targetFile}
Pattern trigger: ${trigger}
Fix strategy: ${fixStrategy}

Current file content:
\`\`\`typescript
${currentSource.slice(0, 8000)}
\`\`\`

Provide a precise string replacement to harden this fix into the source:
- file_path: "${targetFile}"
- search_string: exact string to find in the file (must be unique)
- replacement_string: what to replace it with
- explanation: one sentence describing the change`,
    schema: PromotionSchema,
    model: "sonnet",
    logLabel: "[Watchdog][Promotion]",
  });

  const updated = currentSource.replace(promotion.search_string, promotion.replacement_string);
  if (updated === currentSource) {
    console.warn(`[Watchdog] Promotion search_string not found in ${targetFile} — skipping`);
    return;
  }

  fs.writeFileSync(path.resolve(targetFile), updated, "utf-8");

  const commitMsg = `fix(${agentName}): auto-promote ${step} repair rule from watchdog\n\n${promotion.explanation}`;
  execSync(`git add ${targetFile}`, { cwd: process.cwd() });
  execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: process.cwd() });

  await db.query(
    `UPDATE learned_repair_patterns SET promoted_to_code = true, promoted_at = now() WHERE id = $1`,
    [patternId]
  );

  appendToMarkdown("Failure Patterns",
    `\n> **PROMOTED**: Pattern \`${trigger}\` has been hardcoded into \`${targetFile}\`\n`
  );

  console.log(`[Watchdog] Promoted pattern to ${targetFile} and committed`);
}
```

**Step 2: Add promotion check to `runWatchdogTickWithLlm`**

At the end of `runWatchdogTickWithLlm`, add:

```typescript
// Promote mature patterns to code
const readyToPromote = await db.query<{
  id: string; agent_name: string; step: string; trigger: string; fix_strategy: string; occurrence_count: number;
}>(
  `SELECT id, agent_name, step, trigger, fix_strategy, occurrence_count
   FROM learned_repair_patterns
   WHERE pattern_type = 'failure_pattern'
     AND promoted_to_code = false
     AND fix_strategy IS NOT NULL
     AND occurrence_count >= 5`
);

for (const row of readyToPromote.rows) {
  try {
    await promotePatternToCode(row.id, row.agent_name, row.step, row.fix_strategy, row.trigger, db, llm);
  } catch (err) {
    console.warn(`[Watchdog] Promotion failed for ${row.id}: ${err instanceof Error ? err.message : err}`);
  }
}
```

**Step 3: Run full test suite to confirm nothing broken**

```bash
npx jest --no-coverage 2>&1 | tail -15
# Expected: All tests pass
```

**Step 4: Commit**

```bash
git add src/agents/agent-watchdog/index.ts
git commit -m "feat(watchdog): add code promotion — patches TS source and auto-commits at 5 occurrences"
```

---

## Task 10: End-to-End Smoke Test

**Step 1: Run a short pipeline and verify logging**

```bash
cd /root/general-projects/parallel-callforge
npx tsx src/index.ts pipeline pestcontrol-1 > /tmp/pipe.log 2>&1 &
sleep 30 && tail -20 /tmp/pipe.log
```

**Step 2: Verify `pipeline_run_log` has entries**

```bash
PGPASSWORD=callforge psql -h localhost -p 5434 -U callforge -d callforge \
  -c "SELECT run_id, agent_name, step, status, duration_ms FROM pipeline_run_log ORDER BY created_at DESC LIMIT 10;"
```

Expected: rows with `status = 'success'` for completed steps.

**Step 3: Verify watchdog started**

```bash
tail -5 /tmp/pipe.log | grep -i watchdog
# Expected: "[Pipeline] Watchdog started (PID XXXXX)"
```

**Step 4: Final commit**

```bash
git add docs/watchdog/learned-patterns.md
git commit -m "chore: initialize learned-patterns.md for watchdog output"
```

---

## Summary

| Task | What It Builds | Tests |
|------|---------------|-------|
| 1 | DB migrations (2 tables) | SQL runs clean |
| 2 | `withSelfHealing()` wrapper | 4 unit tests |
| 3 | `run_id` + watchdog child process spawn | Manual verify |
| 4 | Agent 3 Hugo validation wrapped | Existing tests pass |
| 5 | Agent 1 clustering wrapped | Existing tests pass |
| 6 | Agent 0.5 geo refresh wrapped | Existing tests pass |
| 7 | Watchdog poll loop + pattern clustering | 2 unit tests |
| 8 | LLM analysis + markdown logging + main loop | Existing tests pass |
| 9 | Code promotion → git commit | Full suite passes |
| 10 | End-to-end smoke test | Manual verify |

# Full Pipeline Intent Audit Prompt

You are a principal systems auditor reviewing a multi-agent website generation pipeline. Your job is to determine whether the system is fully designed, built, and wired to match the owner intent below.

## Owner Intent (Must Validate)

1. Agent 0.5 reliably selects/ranks city targets from offer ZIP coverage.
2. Agent 1 has a true deep-research phase (subagents/web research) and feeds structured outputs into downstream keyword/city logic.
3. Agent 2 has a true deep-research phase (subagents/web research) and feeds structured outputs into downstream design/copy/schema synthesis.
4. Agent 1 and Agent 2 outputs are correctly consumed by Agent 3.
5. Agent 3 uses hybrid architecture (brief + variable content blocks + deterministic assembly), not legacy one-shot page generation as primary path.
6. Pipeline supports bounded concurrency and keeps going on partial failures.
7. Deep-research failures are loud and explain why (clear logs/events with reason strings).
8. Self-healing is present where intended and retries/repair behavior is observable.
9. Dashboard + pipeline API configs are wired to the same behavior (no silent config drift).
10. Output quality guardrails reduce repetitive/templated “AI obvious” pages (diversity checks + QA gates).

If any intent item is not true, treat it as a gap.

---

## Audit Scope

Audit all architecture layers:

- Code design
- Runtime wiring
- Config defaults and overrides
- Dashboard/pipeline orchestration
- DB migrations/caches/checkpoints
- Failure handling and observability
- Test coverage and current breakpoints

Use concrete file/line evidence.

---

## Required Files To Inspect

### Core Runtime
- `src/index.ts`
- `src/dashboard-server.ts`
- `src/config/env.ts`
- `.env.example`

### Agents
- `src/agents/agent-0.5-geo-scanner/index.ts`
- `src/agents/agent-1-keywords/index.ts`
- `src/agents/agent-1-keywords/research-orchestrator.ts`
- `src/agents/agent-1-keywords/research-reader.ts`
- `src/agents/agent-2-design/index.ts`
- `src/agents/agent-2-design/research-orchestrator.ts`
- `src/agents/agent-2-design/research-reader.ts`
- `src/agents/agent-3-builder/index.ts`

### Shared Infra
- `src/shared/self-healing.ts`
- `src/shared/checkpoints.ts`
- `src/shared/events/*`
- `src/shared/db/migrate.ts`
- `src/shared/db/migrations/*.sql`

### Planning/Intent Docs
- `designdecisions.md`
- `CallForge PRD v7.docx`
- `CallForge PRD v8.docx`
- `CallForge PRD v9.md`
- `docs/plans/2026-03-02-agent-3-hybrid-content-architecture.md`
- `docs/plans/2026-03-05-agent1-deep-research-impl.md`
- `docs/plans/2026-03-05-agent2-deep-research-impl.md`
- Any other relevant markdown plans in `docs/plans/`

### Tests
- `src/integration/pipeline.test.ts`
- Agent tests for 0.5, 1, 2, 3

---

## Mandatory Audit Questions

### A) Agent 0.5
1. Is Agent 0.5 always in the orchestrated sequence before Agent 1 when needed?
2. Does it fail loudly when geo reference data is unusable?
3. Does it checkpoint and resume correctly?
4. Does it clearly pass selected candidates forward (DB + pipeline state)?

### B) Agent 1 Deep Research
1. Is deep research actually invoked (not dead code)?
2. Is it enabled by default where owner expects (CLI + dashboard + pipeline)?
3. Are research outputs validated before synthesis?
4. On failure/degrade, do logs include explicit reason and run context?
5. Are downstream keyword/city outputs still produced with controlled fallback behavior?

### C) Agent 2 Deep Research
1. Same checks as Agent 1.
2. Confirm dashboard and pipeline start paths both include Agent 2 deep research behavior.
3. Confirm checkpoint reuse cannot silently mask invalid research files.

### D) Agent 3 Hybrid Architecture
1. Confirm primary path is hybrid stages:
   - packet build
   - brief generation
   - content block generation
   - deterministic assembly
2. Confirm legacy one-shot full-page generation is removed or strictly fallback-only (and document exact behavior).
3. Confirm hybrid stage caching exists (in-memory + DB migration-backed cache).
4. Confirm stage failures route through self-healing where intended.
5. Confirm partial city/subpage failures are isolated and pipeline continues.

### E) Concurrency + Throughput
1. Is city concurrency configurable from env and dashboard request payload?
2. Is concurrency bounded with safe defaults/caps?
3. Are weekly new-city caps race-safe under concurrency?
4. Is subpage concurrency bounded per city?

### F) Loud Failure + Observability
1. Are deep research failures for Agent 1 and 2 loud and reasoned?
2. Are Agent 3 city/subpage failures loud and reasoned?
3. Are emitted events sufficient for dashboard and logs to explain root cause?
4. Are “degraded but continuing” conditions explicitly labeled?

### G) Self-Healing
1. Where is `withSelfHealing` used?
2. Are retries bounded and logged?
3. Is repair context specific enough for effective fixes?
4. Are there any critical steps missing self-healing where owner intent expects it?

### H) Quality and “AI-obvious output” Risk
1. Is there a cross-page similarity/diversity guard?
2. Does similarity failure trigger repair and then hard-fail if still too similar?
3. Are QA gates enforcing word count, banned phrases, placeholders, phone mention, etc.?
4. Are remaining risks likely to produce repetitive pages detectable as templated output?

### I) Wiring Consistency / Config Drift
1. Compare all entrypoints (`src/index.ts`, dashboard routes, pipeline orchestrator).
2. Identify any flag defaults that conflict across entrypoints.
3. Verify migration dependencies are present for new caches/features.

### J) Test Reality
1. Which tests prove current wiring?
2. Which tests are missing for critical behavior?
3. Identify flaky or invalid test setup issues (Jest/Vitest mismatch, ESM/CJS loader issues, etc.).

---

## Scoring Rubric

Score each section A-J:
- `PASS`: Fully aligned with owner intent, evidence present.
- `PARTIAL`: Implemented but with meaningful gaps/risk.
- `FAIL`: Not implemented, broken, or not wired.

Then provide:
- `Overall Readiness Score` (0-100)
- `Ship Decision`:
  - `Ready`
  - `Ready with constraints`
  - `Not ready`

---

## Gap Reporting Format (Strict)

For every gap:

### Gap [ID]: [Short Title]
- **Severity**: Critical | High | Medium | Low
- **Intent Violated**: [Reference one of Owner Intent 1-10]
- **Evidence**: [File path + line(s) + exact behavior]
- **Current Behavior**: [What happens now]
- **Expected Behavior**: [What should happen]
- **Impact**: [Why this matters for throughput, quality, reliability, monetization]
- **Fix**: [Concrete implementation change]
- **Validation**: [Exact command/test/log check to prove fix]

Order gaps by Severity, then blast radius.

---

## Required Deliverables

1. **Executive Verdict** (10 lines max)
2. **PASS/PARTIAL/FAIL matrix for A-J**
3. **Top 10 blocking gaps**
4. **Wiring trace** from pipeline start -> agent 0.5 -> 1 -> 2 -> 3 -> 7
5. **Failure-mode trace** (deep research fail, city fail, subpage fail, QA fail)
6. **Config truth table** (defaults/overrides across CLI + dashboard + env)
7. **Minimal patch plan** (ordered by highest leverage)
8. **Post-fix verification checklist**

---

## Verification Commands (Run and Report)

Run and include outcomes:

```bash
npx tsc --noEmit
npx jest src/integration/pipeline.test.ts --runInBand
npx jest src/agents/agent-2-design/research-orchestrator.test.ts --runInBand
npx jest src/agents/agent-1-keywords/index.test.ts --runInBand
```

If any command fails, include:
- exact failing suite/test
- root cause category (wiring bug vs test harness issue)
- whether it blocks production pipeline behavior

---

## Guardrails for This Audit

- Do not provide vague advice.
- Do not assume behavior from comments; verify call paths.
- Prefer runtime wiring evidence over design-doc claims.
- Explicitly call out dead code paths.
- Explicitly call out where behavior is “degraded but intentional” vs “bug”.
- If uncertain, mark as `PARTIAL` and state exactly what proof is missing.


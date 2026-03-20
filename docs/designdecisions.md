# Design Decisions

This file records non-obvious implementation choices made during development, including deviations from the original plan and the reasoning behind them.

---

## Agent 1 Deep Research Implementation (2026-03-05)

**Plan:** `docs/plans/2026-03-05-agent1-deep-research-impl.md`

### Decision 1: PlaybookTextSchema wrapper for playbook synthesis

**Problem:** The plan's Task 6 step 3e called `llm.call` without a `schema` parameter:
```typescript
const playbookResult = await llm.call({
  prompt: playbookPrompt,
  model: "sonnet",
  logLabel: "...",
});
```
The comment said "llm.call with no schema returns the raw text". But `LlmClient.call<T extends z.ZodType>(options: LlmCallOptions<T>)` requires `schema: T` — it is not optional in the interface definition.

**Decision:** Added `PlaybookTextSchema = z.object({ markdown: z.string() })` in `index.ts`. The playbook synthesis call uses this schema:
```typescript
const playbookResult = await llm.call({
  prompt: playbookPrompt,
  schema: PlaybookTextSchema,
  model: "sonnet",
  logLabel: "...",
});
playbookContent = playbookResult.markdown;
```
The Claude CLI's `--json-schema` flag instructs the model to wrap its markdown output in `{"markdown": "..."}`. This is consistent with how all other `llm.call` invocations work in the codebase.

**Alternative considered:** Extending `LlmCallOptions` to make `schema` optional and returning raw string. Rejected because it would require changing the shared `LlmClient` interface and all providers, touching far more code than necessary.

---

### Decision 2: Test fixture word count expansion (research-reader.test.ts)

**Problem:** The plan's `VALID_RESEARCH` test fixture was too short (≈93 words) to pass `validateResearchFile`'s 500-word minimum check. This caused the "accepts a valid research file" test to fail despite the implementation being correct.

**Decision:** Expanded `VALID_RESEARCH` to 13 findings (≈530 words) covering a range of pest control keyword types (wildlife removal, bed bugs, termites, mosquitoes, fleas, ants, wasps, rodents, cockroaches, commercial). The additional findings are plausible test data that mirrors real subagent output.

---

### Decision 3: Test assertion fix — markdown bold syntax

**Problem:** The plan's `buildResearchContext` test checked:
```typescript
expect(ctx).toContain("Sources consulted: 42");
```
But `VALID_RESEARCH` uses markdown bold: `**Sources consulted:** 42`. The string `"Sources consulted: 42"` is NOT a substring of `"**Sources consulted:** 42"` (colon is followed by `**`, not a space).

**Decision:** Changed the assertion to `"**Sources consulted:** 42"` to match the actual markdown format in the fixture. The test intent (verifying research context includes file content) is preserved.

---

### Decision 4: Type-only import for ResearchFindings in orchestrator test

**Observation:** Task 4's test imports `type ResearchFindings` from `research-orchestrator.js`. Because this is a type-only import, TypeScript erases it at compile time and vitest does not attempt to load the module at runtime. This means the "verify tests fail before implementation" step passes immediately (the test file already runs), contrary to the plan's expectation that it would fail with "module does not exist".

**Decision:** Proceeded without modification. The real verification that the orchestrator file is required is `npx tsc --noEmit`, which would fail if `research-orchestrator.ts` were absent and any value (not just type) were imported.

---

### Decision 5: `researchEnabled` defaults to false (opt-in)

The research phase adds ~10–15 minutes of wall-clock time (6 parallel subagents browsing real web sources). Making it opt-in via `config.researchEnabled = true` ensures existing pipelines are unaffected. The feature is activated only when explicitly requested by the caller.

---

### Decision 6: `withResearchContext` import collision handling

The function `withResearchContext` was added to `prompts.ts` but `index.ts` already imports from `./prompts.js` (indirectly, through vertical strategies). The direct import was added explicitly:
```typescript
import { buildPlaybookSynthesisPrompt, withResearchContext } from "./prompts.js";
```
No collision — the vertical strategy layer calls a different code path that does not import these new exports.

---

## Claude Session-Limit Fallback + Codex Deep Research (2026-03-06)

### Decision 7: Keep Claude SDK as the main deep-research path

**Context:** Agent 1 and Agent 2 deep research already use `@anthropic-ai/claude-agent-sdk` with parallel subagents. This is the established "main path" and already produces acceptable deep-research outputs.

**Decision:** Do not replace the main path with Codex. Keep Claude SDK as primary orchestration and only activate Codex when Claude fails due to session/usage limits.

**Reasoning:** This preserves known-good behavior and limits blast radius. The Codex work is additive resilience, not a full orchestration rewrite.

---

### Decision 8: Add explicit session-limit detection and fallback trigger

**Problem:** Research orchestrators previously degraded when Claude research failed, but they did not distinguish session-limit failures and did not automatically reroute work to Codex.

**Decision:** Added `detectSessionLimit(...)` in `src/shared/cli/types.ts` and wired Agent 1/2 research orchestrators to:
1. Catch Claude SDK failures
2. Detect session/usage/quota limit signatures
3. Invoke Codex deep-research fallback

**Files:**
- `src/shared/cli/types.ts`
- `src/agents/agent-1-keywords/research-orchestrator.ts`
- `src/agents/agent-2-design/research-orchestrator.ts`

---

### Decision 9: Use a shared Codex deep-research runner with multi-agent-first strategy

**Problem:** Initial Codex fallback implementation was a one-shot prompt asking for all files at once, which is more brittle and less aligned with Codex multi-agent guidance.

**Decision:** Introduced `src/shared/cli/codex-deep-research.ts` as a shared fallback engine for Agent 1 and Agent 2:
- First pass: ask Codex to run a multi-agent-style orchestration (one worker per file in parallel, if enabled).
- Second pass safety net: validate generated files and run targeted retry generation only for missing/invalid files.

**Reasoning:** This aligns with Codex multi-agent concepts while preserving deterministic recovery when multi-agent is unavailable or incomplete.

---

### Decision 10: Add one-time warning when Codex multi-agent feature flag appears disabled

**Problem:** Multi-agent behavior depends on Codex configuration (`[features] multi_agent = true`). Without visibility, users may assume fan-out is active when it is not.

**Decision:** The shared Codex deep-research runner checks:
- `$CODEX_HOME/config.toml` or `~/.codex/config.toml`
- `./.codex/config.toml`

If `multi_agent = true` is not detected in `[features]`, it logs a one-time warning with remediation.

**Reasoning:** Improves operability and makes fallback execution mode explicit in logs without blocking pipeline progress.

---

### Decision 11: Use lightweight quality gates for Codex fallback (not heavy hard constraints)

**Problem:** Strong "deep memo" constraints (very high word/source thresholds and many required sections) improved depth but increased runtime/cost and risked brittle failures.

**Decision:** Adopt lightweight guardrails in Codex fallback:
- Minimum words: 900
- Minimum source-index bullets: 8
- Core structure validation still required (`validateResearchFile`)
- Retry only up to 3 targeted repair rounds for invalid/missing files

**Reasoning:** Matches user preference to keep Codex flexible like Claude main path while still preventing thin outputs.

**Note:** Claude main path remains less constrained by explicit numeric depth gates; Codex fallback uses these light checks to normalize quality under failure conditions.

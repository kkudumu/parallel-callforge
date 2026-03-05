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

# Audit Prompt: Agent 1 Deep Research Implementation

You are a senior TypeScript engineer auditing the implementation of the Agent 1 deep research system in the `parallel-callforge` repository. The implementation plan is at `docs/plans/2026-03-05-agent1-deep-research-impl.md`. Design decisions made during implementation are recorded at `docs/designdecisions.md`.

## What was built

A two-phase research system was added to Agent 1 (`src/agents/agent-1-keywords/`). When `config.researchEnabled = true`:

- **Phase 1:** Spawns 6 parallel Sonnet subagents via the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). Each browses real web sources and writes findings to `tmp/agent1-research/{runId}/*.md` in a validated markdown format.
- **Phase 2a:** Synthesizes all 6 research files into a persistent `docs/playbooks/{niche}/{runId}-playbook.md` using a Sonnet `llm.call`.
- **Phase 2b–2d:** The playbook and targeted research context are prepended to the 3 existing Haiku synthesis calls (keyword templates, city scoring, keyword clustering) via `withResearchContext()`.

## Files introduced (new)

```
src/agents/agent-1-keywords/research-reader.ts       — validateResearchFile, validatePlaybookFile, RESEARCH_FILE_NAMES_A1
src/agents/agent-1-keywords/research-reader.test.ts  — 12 tests
src/agents/agent-1-keywords/subagent-prompts.ts      — 6 prompt builder functions
src/agents/agent-1-keywords/subagent-prompts.test.ts — 13 tests
src/agents/agent-1-keywords/research-orchestrator.ts — runResearchPhase(), ResearchFindings type
src/agents/agent-1-keywords/research-orchestrator.test.ts — 2 tests
src/agents/agent-1-keywords/index.test.ts            — Agent1Config smoke test
```

## Files modified

```
src/agents/agent-1-keywords/prompts.ts   — added buildPlaybookSynthesisPrompt, withResearchContext
src/agents/agent-1-keywords/prompts.test.ts — 7 tests (new file)
src/agents/agent-1-keywords/index.ts    — wired Phase 1 + Phase 2a, updated 3 existing LLM calls
```

## Key design decision to audit

The plan called `llm.call` without a schema for playbook synthesis. The actual `LlmClient` interface requires `schema: T`. The implementation uses `PlaybookTextSchema = z.object({ markdown: z.string() })` instead and extracts `playbookResult.markdown`. See `docs/designdecisions.md` Decision 1 for full rationale.

---

## Audit checklist

For each item, read the relevant source files and answer YES / NO / PARTIAL with a one-line finding. Flag anything that needs fixing.

### Correctness

- [ ] **C1** — Does `validateResearchFile` correctly enforce all three requirements: required headers (`# … Research — …`, `## Key Findings`, `## Source Index`), ≥500 words, and at least one finding block with all three fields (`**Evidence:**`, `**Data:**`, `**Implication:**`)?
- [ ] **C2** — Does `validatePlaybookFile` check for all 11 required `##` sections listed in Contract B of the plan?
- [ ] **C3** — Does `runResearchPhase` abort (throw) if fewer than 4 of the 6 research files pass validation?
- [ ] **C4** — Is `withResearchContext(prompt, null)` a true no-op (returns original prompt unchanged)?
- [ ] **C5** — Does `getKeywordTemplates` bypass cache when `researchContext` is provided (even if `forceRefresh` is false)?
- [ ] **C6** — Does the playbook INSERT into `docs/playbooks/{niche}/` only happen when `validatePlaybookFile` returns true?
- [ ] **C7** — Are the 3 research contexts for templates, scoring, and clustering correctly scoped to the most relevant subagent files (not all 6 every time)?

### Contracts

- [ ] **CT1** — Do the 6 subagent prompts include the mandatory format block (`## Key Findings`, `## Source Index`, `**Evidence:**`, `**Data:**`, `**Implication:**`)?
- [ ] **CT2** — Does `buildPlaybookSynthesisPrompt` include all 11 required section headers in the output instructions?
- [ ] **CT3** — Does `buildPlaybookSynthesisPrompt` instruct the LLM to "only cite" evidence from the research input (not invent data)?
- [ ] **CT4** — Are the Zod schemas for keyword templates, city scoring, and clustering **unchanged** from before this implementation?

### TypeScript / compilation

- [ ] **TS1** — Does `npx tsc --noEmit` pass with 0 errors?
- [ ] **TS2** — Are all new imports using `.js` extensions (ESM compatible)?
- [ ] **TS3** — Is `ResearchFindings` typed correctly (6 fields, each `string | null`)?
- [ ] **TS4** — Is `Agent1Config` updated with `researchEnabled?: boolean` and `researchDir?: string`?

### Tests

- [ ] **T1** — Do all 35 tests in `src/agents/agent-1-keywords/` pass (excluding the pre-existing `agent-1.test.ts` which uses `@jest/globals`)?
- [ ] **T2** — Does `research-reader.test.ts` test both `validateResearchFile` rejection cases (missing headers, short content, no finding blocks) AND `validatePlaybookFile` rejection cases?
- [ ] **T3** — Does `subagent-prompts.test.ts` verify that each of the 6 prompts includes its correct output file path?
- [ ] **T4** — Does `prompts.test.ts` verify that `withResearchContext` with `null` returns the original prompt unmodified?

### Integration wiring

- [ ] **I1** — Is `researchContextForTemplates` passed as the 7th argument to `getKeywordTemplates` in `runAgent1`?
- [ ] **I2** — Is `researchContextForScoring` passed as the 7th argument to `getScoredCities` in `runAgent1`?
- [ ] **I3** — Is `withResearchContext(clusterPrompt, researchContextForClustering)` used in the clustering `llm.call` inside `withSelfHealing`?
- [ ] **I4** — Is `PlaybookTextSchema` defined locally in `index.ts` (not exported from prompts.ts or a shared module)?
- [ ] **I5** — Is the research phase gated correctly: does it only run when `config.researchEnabled === true`?

### Design decisions review

- [ ] **D1** — Is `PlaybookTextSchema = z.object({ markdown: z.string() })` an appropriate workaround for the missing no-schema `llm.call` path? Is there a cleaner alternative given the current `LlmClient` interface?
- [ ] **D2** — Should the 500-word minimum in `validateResearchFile` (imported from Agent 2) be sufficient for research files written by Sonnet subagents in practice?
- [ ] **D3** — Is the `< 4 valid files` abort threshold appropriate, or should it be configurable via `Agent1Config`?

### Risk / gaps

- [ ] **R1** — Is there error handling if the Agent SDK `query()` stream yields an error event mid-stream (not just at the end)?
- [ ] **R2** — Is `tmp/agent1-research/{runId}/` cleaned up after a run, or does it accumulate indefinitely?
- [ ] **R3** — If `playbookContent` is null (validation failed), are the research contexts still useful, or does the downstream Haiku calls receive too little context to improve quality?
- [ ] **R4** — Is there a risk of the playbook `markdown` string being truncated by the `LlmClient` JSON parsing (e.g. unescaped characters in a 4000+ word markdown document)?

---

## How to run verification

```bash
# All agent-1 unit tests
npx vitest run src/agents/agent-1-keywords/

# TypeScript clean compile
npx tsc --noEmit

# Inspect the new files
cat src/agents/agent-1-keywords/research-reader.ts
cat src/agents/agent-1-keywords/research-orchestrator.ts
cat src/agents/agent-1-keywords/prompts.ts | tail -100
cat src/agents/agent-1-keywords/index.ts | grep -A 80 "Phase 1"

# Review design decisions
cat docs/designdecisions.md
```

## Expected outcome

A written audit report covering all checklist items above. For any item marked NO or PARTIAL, provide a specific fix recommendation with the exact file and line/function to change. For D1–D3 and R1–R4, provide a severity rating (Low / Medium / High) and whether a fix is required before this feature can be used in production.

Audit the Agent 2 deep research rebuild in this codebase against its plan and tests.

## What was built

The plan is at: docs/plans/2026-03-05-agent2-deep-research-impl.md

New files created:
- src/agents/agent-2-design/research-reader.ts
- src/agents/agent-2-design/research-reader.test.ts
- src/agents/agent-2-design/subagent-prompts.ts
- src/agents/agent-2-design/research-orchestrator.ts
- src/agents/agent-2-design/research-orchestrator.test.ts

Modified files:
- src/agents/agent-2-design/prompts.ts
- src/agents/agent-2-design/index.ts
- package.json (added @anthropic-ai/claude-agent-sdk)
- src/agents/agent-3-builder/hugo-manager.ts (YAML escape fixes)

Commits spanning this work: 9d1f6f1..50c65f7

## What to audit

**1. Plan completeness** — Read the plan. For each task (Tasks 1–7), verify
the implementation matches exactly what was specified. Flag anything the plan
required that is missing, wrong, or only partially done.

**2. LLM interface contract** — The plan defines a mandatory file format
(## Key Findings / ### [Title] / **Evidence:** / **Data:** / **Implication:**
/ ## Source Index) that subagents must write and synthesis must read. Verify
research-reader.ts enforces this contract correctly. Verify the 6 prompts in
subagent-prompts.ts instruct subagents to write exactly this format. Verify
synthesis prompts in prompts.ts use the research as context.

**3. Test coverage vs plan requirements** — Read the test files. Do the tests
actually validate the plan's stated requirements? Are there plan requirements
with no corresponding test? Are there tests that test the wrong thing?

**4. Integration wire-up** — Read index.ts. Verify:
  - Phase 1 research runs BEFORE any synthesis call
  - researchCtx is passed into ALL 5 buildXxxPrompt() calls
  - research_complete checkpoint is set after Phase 1
  - researchDir is cleaned up after successful completion
  - The checkpoint reuse path (skipping research on re-runs) is correct
  - withSelfHealing wraps ALL 5 synthesis calls (not just some)

**5. Backward compatibility** — Verify the legacy named exports at the bottom
of prompts.ts (COMPETITOR_ANALYSIS_PROMPT etc.) still satisfy what
src/verticals/default/strategy.ts imports.

**6. Error paths** — What happens if runResearchPhase() throws? What happens
if all 6 research files fail validation? Does Agent 2 degrade gracefully or
hard-crash?

**7. Notable deviations** — Note any places where the implementation diverged
from the plan and explain whether the deviation is safe or a risk.

## Output format

For each section above, give:
- PASS / PARTIAL / FAIL
- Specific line references for any issues
- A severity: Critical (blocks correctness) / Important (risk) / Minor (polish)

End with an overall verdict: SHIP IT / NEEDS FIXES / MAJOR GAPS

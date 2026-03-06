# Pipeline Audit Fix Plan

Checkpoint plan for all audit fixes. Execute in order, check off as complete.

## P0 — Critical / Must-Fix

- [x] **P0-1**: Agent 1 research failure → degrade instead of throw
  - File: `src/agents/agent-1-keywords/index.ts:794-806`
  - Change: catch research error, log DEGRADED, set researchFindings=null, continue
  - Also fix misleading comment at line 337
  - **DONE**: Changed `throw error` → `researchFindings = null` with DEGRADED log; added null guard around post-research processing; fixed comment

- [x] **P0-2**: Fix 5 vitest test files to use jest
  - `src/agents/agent-1-keywords/index.test.ts` — change vitest→@jest/globals
  - `src/agents/agent-1-keywords/prompts.test.ts` — change vitest→@jest/globals
  - `src/agents/agent-1-keywords/subagent-prompts.test.ts` — change vitest→@jest/globals
  - `src/agents/agent-1-keywords/research-reader.test.ts` — change vitest→@jest/globals
  - `src/agents/agent-1-keywords/research-orchestrator.test.ts` — vitest→@jest/globals + vi.*→jest.*
  - **DONE**: All 5 files converted. research-orchestrator.test.ts fully rewritten with jest.mock/jest.fn

- [x] **P0-3**: Commit migration 014 (hybrid cache tables)
  - File: `src/shared/db/migrations/014-agent3-hybrid-cache.sql` — already exists, just untracked
  - **DONE**: Will be staged with git add in commit

- [x] **P0-4**: Fix stale Agent 1 test assertion
  - File: `src/agents/agent-1-keywords/agent-1.test.ts:68-70`
  - Change: expect 4 params instead of 2
  - **DONE**: Updated assertion to expect `["pest-control", result, "generated", expect.any(Number)]`

## P1 — High / Should-Fix

- [x] **P1-1**: Add `agent_error` emissions to agents 1, 2, 3
  - Agent 1: `src/agents/agent-1-keywords/index.ts` — added catch block with agent_error emission before re-throw
  - Agent 2: `src/agents/agent-2-design/index.ts` — wrapped runAgent2 body in try/catch with agent_error
  - Agent 3: `src/agents/agent-3-builder/index.ts` — changed city/subpage events to agent_error; added top-level agent_error in catch
  - **DONE**: All 3 agents now emit agent_error on failure

- [x] **P1-2**: Add `runId` to Agent2Config + wire through
  - `src/agents/agent-2-design/index.ts` — added runId to interface, replaced 5x "no-run-id" with config.runId ?? "no-run-id"
  - `src/index.ts` — passed runId in pipeline + orchestrate paths
  - `src/dashboard-server.ts` — created pipelineRunId, passed to Agent 2
  - **DONE**: Agent 2 self-healing now traceable to pipeline runs

- [x] **P1-3**: Add runId/offerId to Agent 3 failure logs
  - `src/agents/agent-3-builder/index.ts` — added runId + offerId to SUBPAGE_FAILED and CITY_FAILED logs
  - **DONE**: Both failure log lines include runId and offerId

- [x] **P1-4**: Pass `llm` + `runId` to dashboard Agent 0.5 calls
  - `src/dashboard-server.ts` geo-scan endpoint — added llm client creation + runId
  - `src/dashboard-server.ts` pipeline Agent 0.5 — added llm + pipelineRunId
  - **DONE**: Dashboard geo scans now have self-healing capability

## P2 — Medium

- [x] **P2-1**: Add `AGENT1_RESEARCH_ENABLED` env var
  - `src/config/env.ts` — added AGENT1_RESEARCH_ENABLED boolean env var, default true
  - `src/index.ts` — buildAgent1Config uses env.AGENT1_RESEARCH_ENABLED as fallback
  - `src/dashboard-server.ts` — buildAgent1Config uses env.AGENT1_RESEARCH_ENABLED
  - **DONE**: Operators can disable research via env without code change

## P3 — Structural / Hardening (Round 2)

- [x] **P3-1**: Register Agent 0.5 in runOrchestrated() handler map
  - `src/index.ts` — added agent-0.5 handler to agentHandlers map
  - **DONE**: Orchestrator can now dispatch Agent 0.5

- [x] **P3-2**: Wire enforceNewCityCap from env + dashboard payload
  - `src/config/env.ts` — added AGENT3_ENFORCE_NEW_CITY_CAP and AGENT3_MAX_NEW_CITIES_PER_WEEK env vars
  - `src/index.ts` — wired to CLI pipeline, orchestrate agent-3 handler
  - `src/dashboard-server.ts` — wired to dashboard agent-3 handler
  - **DONE**: All 3 entrypoints pass enforceNewCityCap + maxNewCitiesPerWeek to Agent 3

- [x] **P3-3**: Add withSelfHealing to Agent 1 getKeywordTemplates
  - `src/agents/agent-1-keywords/index.ts` — wrapped LLM call in withSelfHealing with repair hint pattern
  - Added runId/offerId params to function signature and call site
  - **DONE**: Keyword template generation now self-heals on schema/LLM failures

- [x] **P3-4**: Add withSelfHealing to Agent 1 getScoredCities
  - `src/agents/agent-1-keywords/index.ts` — wrapped LLM call in withSelfHealing with repair hint
  - **DONE**: City scoring now self-heals on schema/LLM failures

- [x] **P3-5**: Add event bus emissions to withSelfHealing
  - `src/shared/self-healing.ts` — added import for eventBus + AgentName
  - Emits agent_step on repair attempt, agent_step on recovery, agent_error on dead
  - **DONE**: Dashboard now sees all self-healing activity in real time

- [x] **P3-6**: Load existing pages into similarity guard at runAgent3 startup
  - `src/agents/agent-3-builder/index.ts` — seeds batchSimilarityHistory from existing Hugo content
  - Reads all _index.md (hubs) and *.md (subpages) from content directory
  - **DONE**: Cross-run diversity enforced — new pages checked against all existing content

- [x] **P3-7**: Fix triple-CTA templating signal in assemblePageFromHybrid
  - `src/agents/agent-3-builder/index.ts:402` — reduced 3x `Call now:` to single CTA
  - **DONE**: Pages no longer have spammy triple phone number repetition

- [x] **P3-8**: Add second QA repair attempt before publishing degraded content
  - `src/agents/agent-3-builder/index.ts` — added 2nd repair pass for both hub and subpage QA
  - If 1st repair fails, a 2nd LLM repair pass runs before falling back to best-available
  - **DONE**: Doubles QA self-healing capability for both page types

- [x] **P3-9**: Expand testimonial generation with more variation
  - `src/agents/agent-3-builder/index.ts` — expanded from 3 to 6 testimonial templates
  - Added deterministic seed-based selection for per-city/service variation
  - Added varied rating distribution (5.0, 4.9, 4.8)
  - **DONE**: Testimonials vary across cities instead of being identical

- [x] **P3-10**: Add runId/step/city fields to AgentErrorEvent type
  - `src/shared/events/event-types.ts` — added optional runId, step, city to AgentErrorEvent
  - **DONE**: Error events can now carry full context for debugging

## P4 — Config Parity (Round 3)

- [x] **P4-1**: Update `.env.example` with all env vars from env.ts
  - Added 11 missing vars: GEMINI_CLI_PATH, CITY_SOURCE_MODE, AGENT7_PROVIDER, AGENT1_RESEARCH_ENABLED, AGENT2_RESEARCH_ENABLED, AGENT3_ENFORCE_NEW_CITY_CAP, AGENT3_MAX_NEW_CITIES_PER_WEEK, SEARCH_CONSOLE_INTEGRATION_ENABLED, INDEXATION_KILL_SWITCH_ENABLED, INDEXATION_MIN_PAGE_AGE_DAYS, INDEXATION_LOOKBACK_DAYS, INDEXATION_RATIO_THRESHOLD, DISCORD_WEBHOOK_URL
  - Organized into sections: credentials, agent behavior, indexation controls
  - **DONE**: All env vars documented with defaults

- [x] **P4-2**: Add `AGENT2_RESEARCH_ENABLED` env var + wire through
  - `src/config/env.ts` — added AGENT2_RESEARCH_ENABLED boolean, default true
  - `src/agents/agent-2-design/index.ts` — added researchEnabled to Agent2Config, skip research if false
  - `src/index.ts` — passed env.AGENT2_RESEARCH_ENABLED in all 3 Agent 2 call sites (CLI, pipeline, orchestrate)
  - `src/dashboard-server.ts` — passed env.AGENT2_RESEARCH_ENABLED to dashboard Agent 2 handler
  - **DONE**: Agent 2 research now has symmetric kill switch with Agent 1

## Verification

- [x] **V1**: `npx tsc --noEmit` — 0 errors ✓
- [x] **V2**: `npx jest --runInBand` — 30/30 suites, 247/247 tests ✓
- [x] **V3**: All verification passes after all 3 rounds of fixes

## Files Modified

- `src/agents/agent-1-keywords/index.ts` — P0-1, P1-1, P3-3, P3-4
- `src/agents/agent-1-keywords/index.test.ts` — P0-2
- `src/agents/agent-1-keywords/prompts.test.ts` — P0-2
- `src/agents/agent-1-keywords/subagent-prompts.test.ts` — P0-2
- `src/agents/agent-1-keywords/research-reader.test.ts` — P0-2
- `src/agents/agent-1-keywords/research-orchestrator.test.ts` — P0-2
- `src/agents/agent-1-keywords/agent-1.test.ts` — P0-4, P3-3 (updated for withSelfHealing db call count)
- `src/agents/agent-2-design/index.ts` — P1-1, P1-2, P4-2
- `src/agents/agent-3-builder/index.ts` — P1-1, P1-3, P3-6, P3-7, P3-8, P3-9
- `src/config/env.ts` — P2-1, P3-2, P4-2
- `src/index.ts` — P1-2, P2-1, P3-1, P3-2, P4-2
- `src/dashboard-server.ts` — P1-2, P1-4, P2-1, P3-2, P4-2
- `src/shared/self-healing.ts` — P3-5
- `src/shared/events/event-types.ts` — P3-10
- `src/shared/db/migrations/014-agent3-hybrid-cache.sql` — P0-3 (stage for commit)
- `.env.example` — P4-1

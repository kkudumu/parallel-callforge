# Agent 1/2 Upgrade Plan

Goal: make pipeline runtime closer to chat UX while preserving reliability and observability.

- [x] Add continuous progress/error logging for long-running research and supervisor watchdog.
- [x] Add configurable research depth modes: `fast | standard | deep`.
- [x] Add strict time budgets per research mode (phase max + stall max).
- [x] Add reusable research snapshot cache with TTL + fingerprint.
- [x] Reuse fresh snapshots before launching deep research.
- [x] Add async background refresh path for `fast` mode when cache is missing/stale.
- [x] Tighten stop conditions: proceed once minimum valid threshold is met by mode.
- [x] Wire mode settings from env through pipeline entrypoints.
- [x] Add/update tests for env parsing and orchestrator/index behavior.
- [x] Run build + targeted tests and verify pipeline command behavior.

## Validation Checklist
- [x] `npm run build`
- [x] `npm test -- src/config/env.test.ts`
- [x] `npm test -- src/agents/agent-1-keywords/research-orchestrator.test.ts src/agents/agent-2-design/research-orchestrator.test.ts`
- [x] `npm test -- src/agents/agent-1-keywords/index.test.ts src/agents/agent-2-design/index.test.ts`
- [x] `node dist/index.js pipeline --help` and `node dist/index.js pipeline-once --help`

## Completed Implementation Map
- [x] `src/config/env.ts`: added `AGENT1_RESEARCH_MODE` + `AGENT2_RESEARCH_MODE`.
- [x] `src/index.ts`: wired research modes into Agent 1/2 config paths.
- [x] `src/shared/research-snapshot-cache.ts`: implemented snapshot save/load/hydrate with TTL/fingerprint checks.
- [x] `src/agents/agent-1-keywords/index.ts`: mode policy, snapshot reuse, fast-mode async refresh, threshold gating.
- [x] `src/agents/agent-2-design/index.ts`: mode policy, snapshot reuse, fast-mode async refresh, threshold gating.
- [x] `src/agents/agent-1-keywords/research-orchestrator.ts`: heartbeat logging + stall/timeout watchdog + Codex fallback path.
- [x] `src/agents/agent-2-design/research-orchestrator.ts`: heartbeat logging + stall/timeout watchdog + Codex fallback path.

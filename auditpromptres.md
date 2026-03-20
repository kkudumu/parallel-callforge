You are auditing a recently implemented multi-provider load balancing system for a content pipeline. Your job is to validate that the implementation matches the original intent and is production-ready.

## Original Intent

The pipeline burns ~2-6M tokens per run, with ~95% flowing through Claude. The goal was to distribute research workload evenly across Claude, Codex, and Gemini (~33% each) while maintaining deep-research quality (50+ sources, 2000+ words, 15+ findings per topic). Content generation (Agent 3) should also rotate across providers instead of always trying Claude first.

Key design decisions:
1. Iterative deepening — validate output quality, re-prompt same provider with targeted gap-filling queries, up to 3 retries on SAME provider (no escalation to Claude on failure)
2. Quality thresholds: 50 sources, 2000 words, 15 findings per research file
3. Synthesis stays on Claude — playbook/design-spec generation uses waterfall (Claude-first) client, only ~5-10% of tokens
4. Even 4-4-4 split — round-robin assignment across 6 research jobs + 3 providers = 2 per provider per agent
5. Monitoring only, no throttling — log per-provider metrics for tuning
6. Agent 3 content gen uses round-robin LLM client (configurable back to waterfall)

## Files to Audit

NEW files:
- src/shared/cli/deep-research-runner.ts
- src/shared/cli/gemini-deep-research.ts
- src/shared/cli/research-distributor.ts

MODIFIED files:
- src/shared/cli/codex-deep-research.ts (added runCodexSingleResearch export)
- src/shared/cli/llm-client.ts (added provider field + createRoundRobinLlmClient)
- src/config/env.ts (added 6 env vars)
- src/agents/agent-1-keywords/research-orchestrator.ts (replaced SDK orchestrator with distributor)
- src/agents/agent-2-design/research-orchestrator.ts (same refactoring)
- src/index.ts (round-robin client wiring for Agent 3)
- src/dashboard-server.ts (same)
- src/orchestrator/index.ts (verified no direct Agent 3 usage)

UNCHANGED (should NOT have been modified):
- src/agents/agent-1-keywords/subagent-prompts.ts
- src/agents/agent-2-design/subagent-prompts.ts
- src/agents/agent-*/research-reader.ts
- src/shared/cli/run-command.ts
- src/shared/cli/claude-cli.ts
- src/shared/cli/codex-cli.ts
- src/shared/cli/gemini-cli.ts
- src/shared/cli/rate-limiter.ts
- src/shared/cli/types.ts
- src/supervisor.ts (spawns pipeline as subprocess, doesn't call agents directly)

## Validation Checklist

For each item, report PASS, FAIL, or CONCERN with a brief explanation.

### A. Architectural Correctness

1. **Distribution is round-robin**: Does distributeJobs() cycle job0→claude, job1→codex, job2→gemini, job3→claude...? Verify the algorithm, not just the name.

2. **Full prompts used**: Are the FULL subagent prompts from subagent-prompts.ts passed to every provider (not degraded short versions like the old Codex fallback used)?

3. **Iterative deepening loop**: Does the deepening prompt (a) read the existing file, (b) calculate specific gaps (sources needed, findings needed), (c) generate topic-specific additional search queries, (d) re-invoke the SAME provider (not escalate to Claude)?

4. **Claude research uses Agent SDK**: Does the Claude provider path import and use @anthropic-ai/claude-agent-sdk query() with WebSearch/WebFetch/Write tools? NOT the CLI wrapper.

5. **Codex/Gemini use CLI wrappers**: Do they use createCodexCli/createGeminiCli → invoke() pattern consistent with existing codebase?

6. **Synthesis untouched**: Verify that Agent 1's playbook synthesis and Agent 2's design-spec synthesis still use the waterfall LlmClient (Claude-first), NOT the round-robin client. Check where llm vs agent3Llm is passed.

7. **Round-robin client fallback**: If the selected provider fails in round-robin mode, does it waterfall to the next provider in rotation order (not always fall back to Claude)?

### B. Quality Enforcement

8. **Thresholds configurable via env**: Are RESEARCH_MIN_SOURCES (default 50), RESEARCH_MIN_WORDS (default 2000), RESEARCH_MIN_FINDINGS (default 15), RESEARCH_MAX_DEEPENING_PASSES (default 3) all wired from env.ts through to the runner?

9. **Quality scoring accuracy**: Does scoreResearchContent() correctly count (a) source lines (matching /^-\s+\S+/ in Source Index section only), (b) word count, (c) finding blocks (### with Evidence/Data/Implication)?

10. **Deepening prompt quality**: Are the dynamically generated search queries actually topic-specific? Check that a "Keyword Pattern" topic gets keyword-related queries, not generic ones.

11. **File validation preserved**: Do both orchestrators still call validateResearchFile() from research-reader.ts on the final output? Is the minimum valid file threshold (4 of 6) preserved for Agent 1?

### C. Configuration & Backwards Compatibility

12. **RESEARCH_PROVIDER_SPLIT=claude only**: If set to just "claude", does the system work correctly (all 6 jobs on Claude, no Codex/Gemini)?

13. **AGENT3_LLM_MODE=waterfall**: Does setting this revert Agent 3 to the old Claude-first waterfall behavior in ALL entry points (index.ts runSingleAgent, runPipeline, runOrchestrated, dashboard-server)?

14. **Default behavior**: With NO env vars set, does the system default to 3-provider split for research and round-robin for Agent 3?

15. **No breaking changes to existing interfaces**: Do runAgent1(), runAgent2(), runAgent3() still accept the same parameters? Are the ResearchFindings types unchanged?

### D. Error Handling & Resilience

16. **Provider failure isolation**: If Codex is unavailable (binary not found, crashes), do the other providers' jobs still complete? Does Promise.all handle partial failures?

17. **Timeout handling**: Is there a per-pass timeout for each provider invocation? What happens if a deepening pass times out — does it count as an attempt and move on?

18. **Missing file handling**: If a provider fails to write the output file at all, does the deepening loop handle this gracefully (retry with original prompt)?

19. **Session limit detection removed**: The old orchestrators had detectSessionLimit() to catch Claude rate limits and fall back to Codex. Is this no longer needed? Or is there a gap where Claude session limits could cause silent failures?

### E. Metrics & Observability

20. **Per-job logging**: Does each research job log its provider, filename, duration, source/word/finding counts, and deepening passes used?

21. **Per-provider summary**: Is there an aggregate summary logged after all jobs complete showing per-provider averages?

22. **Round-robin logging**: Does the content gen client log which provider was selected for each call and the call number?

### F. Code Quality

23. **No dead code**: Were the old functions (loadAgentSdkQuery, nextOrTick, buildOrchestratorPrompt, runCodexFallbackResearch, summarizeResearchProgress) actually removed from both orchestrator files? No zombie code left?

24. **No unused imports**: Check all modified files for unused imports.

25. **TypeScript compiles clean**: Run `npx tsc --noEmit` and report any errors.

26. **Consistent logging prefixes**: Do logs use [Agent 1][Research] and [Agent 2][Research] prefixes consistently, with provider name in brackets like [claude], [codex], [gemini]?

### G. Risk Assessment

27. **Token budget reality check**: With iterative deepening (up to 3 passes per job), worst case is 4 invocations × 6 jobs = 24 provider calls per agent. At ~50-100K tokens per research call, that's potentially 1.2-2.4M tokens per agent. Is this within the stated budget of ~680K-1.1M per run on Claude? Could deepening passes blow past the budget?

28. **Parallel execution risk**: All 6 research jobs run via Promise.all. If all 6 hit the same provider simultaneously (e.g., RESEARCH_PROVIDER_SPLIT=claude), could this trigger rate limits? The old system used an SDK orchestrator that managed concurrency internally.

29. **Agent SDK usage pattern**: The Claude research path uses query() from the Agent SDK. Is this the correct usage pattern — bare query() without an orchestrator, with the research prompt as the direct prompt? Or does the SDK expect an orchestrator pattern?

## Output Format

For each numbered item, provide:
- **Status**: PASS / FAIL / CONCERN
- **Evidence**: Quote the specific code or logic that supports your assessment
- **Fix** (if FAIL/CONCERN): What needs to change

End with an overall assessment: SHIP IT / NEEDS FIXES / NEEDS RETHINK

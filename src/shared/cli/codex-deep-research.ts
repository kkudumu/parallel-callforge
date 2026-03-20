import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCodexCli } from "./codex-cli.js";
import { extractJson } from "./types.js";

export async function runCodexSingleResearch(
  codexPath: string,
  prompt: string,
  options: { timeoutMs?: number; logPrefix: string }
): Promise<void> {
  const codex = createCodexCli(codexPath);
  const timeoutMs = options.timeoutMs ?? 12 * 60_000;

  console.log(`${options.logPrefix} Starting Codex single research`);
  await codex.invoke({ prompt, timeoutMs });
  console.log(`${options.logPrefix} Codex single research completed`);
}

export interface CodexResearchJob {
  filename: string;
  topic: string;
  focus: string;
}

export interface RunCodexDeepResearchOptions {
  codexPath: string;
  niche: string;
  researchDir: string;
  jobs: CodexResearchJob[];
  logPrefix: string;
  validateContent: (content: string) => boolean;
  triggerReason: string;
}

interface ValidationResult {
  job: CodexResearchJob;
  valid: boolean;
  reason: string;
}

const TARGET_MIN_WORDS = 900;
const TARGET_MIN_SOURCES = 8;

let warnedAboutMultiAgentConfig = false;

function isMultiAgentEnabledInToml(content: string): boolean {
  const featuresBlockMatch = content.match(/\[features\]([\s\S]*?)(?:\n\[|$)/);
  if (!featuresBlockMatch) {
    return false;
  }

  return /^\s*multi_agent\s*=\s*true\s*$/m.test(featuresBlockMatch[1]);
}

function isCodexMultiAgentEnabled(): boolean {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const candidatePaths = [
    join(codexHome, "config.toml"),
    join(process.cwd(), ".codex", "config.toml"),
  ];

  for (const path of candidatePaths) {
    if (!existsSync(path)) {
      continue;
    }

    try {
      const content = readFileSync(path, "utf8");
      if (isMultiAgentEnabledInToml(content)) {
        return true;
      }
    } catch {
      // Ignore parse/read failures and continue searching other config paths.
    }
  }

  return false;
}

function maybeWarnMultiAgentDisabled(logPrefix: string): void {
  if (warnedAboutMultiAgentConfig) {
    return;
  }

  warnedAboutMultiAgentConfig = true;
  if (isCodexMultiAgentEnabled()) {
    return;
  }

  console.warn(
    `${logPrefix} Codex multi-agent does not appear enabled. ` +
      `Set [features] multi_agent = true in ~/.codex/config.toml (or ./.codex/config.toml) and restart Codex for parallel sub-agent fan-out.`
  );
}

function validateJobs(
  jobs: CodexResearchJob[],
  researchDir: string,
  validateContent: (content: string) => boolean
): ValidationResult[] {
  return jobs.map((job) => {
    const path = join(researchDir, job.filename);
    if (!existsSync(path)) {
      return { job, valid: false, reason: "file_missing" };
    }

    const content = readFileSync(path, "utf8");
    const sourceLines = content.match(/^-\s+\S+/gm)?.length ?? 0;
    const wordCount = content.trim().split(/\s+/).length;

    if (!validateContent(content)) {
      return { job, valid: false, reason: "validation_failed" };
    }
    if (wordCount < TARGET_MIN_WORDS) {
      return { job, valid: false, reason: `insufficient_depth_words:${wordCount}` };
    }
    if (sourceLines < TARGET_MIN_SOURCES) {
      return { job, valid: false, reason: `insufficient_sources:${sourceLines}` };
    }

    return { job, valid: true, reason: "ok" };
  });
}

export async function runCodexDeepResearch(
  options: RunCodexDeepResearchOptions
): Promise<void> {
  const {
    codexPath,
    niche,
    researchDir,
    jobs,
    logPrefix,
    validateContent,
    triggerReason,
  } = options;
  const codex = createCodexCli(codexPath);
  maybeWarnMultiAgentDisabled(logPrefix);

  // Multi-agent-first orchestration: ask Codex to fan out one worker per file.
  // If multi-agent is not enabled, Codex can still execute this sequentially.
  const orchestrationPrompt = `Claude research agent hit a session limit and cannot continue.

Run a deep research batch for niche "${niche}" and output files under: ${researchDir}

Desired workflow (Codex multi-agent):
1) Spawn one worker agent per target file in parallel.
2) Each worker researches only its assigned topic and writes exactly one markdown file.
3) Wait for all workers to finish and verify files exist.

Target files and focus:
${jobs.map((job) => `- ${job.filename}: ${job.focus}`).join("\n")}

For each file, enforce:
- First line: "# <Topic> Research — ${niche}"
- Includes "## Key Findings"
- At least 4 blocks:
  ### <finding>
  **Evidence:** <source>
  **Data:** <specific stat/fact>
  **Implication:** <actionable implication>
- Includes "## Source Index"
- At least ${TARGET_MIN_SOURCES} source bullets under Source Index
- At least ${TARGET_MIN_WORDS} words
- Real sources only, no fabricated citations
- Keep it substantial and concrete; avoid shallow summaries

If multi-agent capability is unavailable, continue with equivalent single-agent execution and produce all files.
Return a concise completion summary.`;

  try {
    await codex.invoke({
      prompt: orchestrationPrompt,
      timeoutMs: 12 * 60_000,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `${logPrefix} Codex orchestration pass failed, falling back to targeted retries: ${reason.split("\n")[0]}`
    );
  }

  const schema = JSON.stringify({
    type: "object",
    properties: {
      markdown: { type: "string" },
    },
    required: ["markdown"],
    additionalProperties: false,
  });

  const maxAttempts = 3;
  let pending = validateJobs(jobs, researchDir, validateContent)
    .filter((result) => !result.valid)
    .map((result) => result);

  for (let attempt = 1; attempt <= maxAttempts && pending.length > 0; attempt++) {
    const attemptResults = await Promise.all(
      pending.map(async (item) => {
        const path = join(researchDir, item.job.filename);
        const prompt = `Generate a single research artifact.

Target file: ${item.job.filename}
Niche: ${niche}
Research focus: ${item.job.focus}
Previous validation issue: ${item.reason}

Return JSON with one field "markdown" only.
The markdown must follow this exact format:
- First line must be: "# ${item.job.topic} Research — ${niche}"
- Include section: "## Key Findings"
- Include at least 4 finding blocks in this exact shape:
  ### <finding title>
  **Evidence:** <URL or clearly attributable source>
  **Data:** <specific stat/benchmark/fact>
  **Implication:** <actionable implication>
- Include section: "## Source Index"
- Include at least ${TARGET_MIN_SOURCES} source bullets in Source Index with this format:
  - <url> — <what this source supports>
- Minimum ${TARGET_MIN_WORDS} words.
- Include quantitative details where possible and avoid high-level fluff.

Use real web research. Do not fabricate sources.`;

        try {
          const response = await codex.invoke({
            prompt,
            jsonSchema: schema,
            timeoutMs: 8 * 60_000,
          });
          const parsed = extractJson(String(response.result)) as Record<string, unknown>;
          const markdown = typeof parsed.markdown === "string" ? parsed.markdown : "";
          writeFileSync(path, markdown, "utf8");

          if (!validateContent(markdown)) {
            return { ...item, valid: false, reason: "validation_failed_after_retry" };
          }

          return { ...item, valid: true, reason: "ok" };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return {
            ...item,
            valid: false,
            reason: `invoke_failed:${reason.split("\n")[0]}`,
          };
        }
      })
    );

    pending = attemptResults.filter((result) => !result.valid);
    const successCount = attemptResults.length - pending.length;
    console.log(
      `${logPrefix} Codex targeted retry attempt ${attempt}/${maxAttempts}: ${successCount}/${attemptResults.length} repaired`
    );
  }

  if (pending.length > 0) {
    const details = pending.map((item) => `${item.job.filename}:${item.reason}`).join(", ");
    throw new Error(
      `${logPrefix} Failed to produce valid research files after Codex retries (${details})`
    );
  }

  console.warn(
    `${logPrefix} Codex deep-research fallback completed after Claude session limit: ${triggerReason.split("\n")[0]}`
  );
}

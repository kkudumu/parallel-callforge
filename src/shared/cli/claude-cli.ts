import { execFile } from "node:child_process";
import type { CliProvider, CliInvokeOptions, CliResult } from "./types.js";
import { extractJson, detectRateLimit } from "./types.js";

function shouldRetryWithoutDangerousPermissions(output: string): boolean {
  return /--dangerously-skip-permissions cannot be used with root\/sudo privileges/i.test(output);
}

function isRunningAsRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/**
 * Check whether a JSON Schema is compatible with Claude's structured output.
 * Unsupported features: anyOf/oneOf at non-root level, propertyNames,
 * additionalProperties that isn't false (i.e. open records).
 * When incompatible, the schema should be inlined into the prompt instead.
 */
export function isClaudeSchemaCompatible(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return true;

  const node = schema as Record<string, unknown>;

  if ("propertyNames" in node) return false;
  if ("anyOf" in node || "oneOf" in node) return false;
  if (node.type === "object" && "additionalProperties" in node && node.additionalProperties !== false) {
    return false;
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!isClaudeSchemaCompatible(item)) return false;
        }
      } else {
        if (!isClaudeSchemaCompatible(value)) return false;
      }
    }
  }

  return true;
}

function execFileWithClosedStdin(
  file: string,
  args: string[],
  options: {
    timeout: number;
    maxBuffer: number;
    env: Record<string, string | undefined>;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        ...options,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          (error as any).stdout = stdout;
          (error as any).stderr = stderr;
          reject(error);
          return;
        }

        resolve({ stdout, stderr });
      }
    );

    child.stdin?.end();
  });
}

export function createClaudeCli(cliPath: string): CliProvider {
  return {
    name: "claude",

    async invoke(options: CliInvokeOptions): Promise<CliResult> {
      const promptArgs = ["-p", "--output-format", "json"];

      if (options.model) {
        promptArgs.push("--model", options.model);
      }

      const defaultArgs = [...promptArgs];

      if (options.jsonSchema) {
        const parsedSchema = JSON.parse(options.jsonSchema) as unknown;

        if (isClaudeSchemaCompatible(parsedSchema)) {
          defaultArgs.push("--json-schema", options.jsonSchema);
        } else {
          // Schema uses features Claude structured output doesn't support.
          // Inline it into the prompt so the LLM still sees the schema.
          options = {
            ...options,
            prompt: `${options.prompt}\n\nJSON Schema:\n${options.jsonSchema}\n\nOutput ONLY valid JSON matching this schema.`,
            jsonSchema: undefined,
          };
        }
      }

      if (options.maxTurns) {
        defaultArgs.push("--max-turns", String(options.maxTurns));
      }

      // Prompt must be the last positional argument
      defaultArgs.push(options.prompt);
      const privilegedArgs = isRunningAsRoot()
        ? defaultArgs
        : ["--dangerously-skip-permissions", ...defaultArgs];
      const bypassPermissionArgs = ["--permission-mode", "bypassPermissions", ...defaultArgs];

      try {
        // Remove CLAUDECODE to avoid "cannot launch inside another session" error
        const childEnv: Record<string, string | undefined> = { ...process.env, IS_SANDBOX: "1" };
        delete childEnv.CLAUDECODE;
        let stdout = "";
        let stderr = "";

        try {
          const result = await execFileWithClosedStdin(cliPath, privilegedArgs, {
            timeout: options.timeoutMs ?? 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: childEnv,
          });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (err: any) {
          const firstStdout = err.stdout ?? "";
          const firstStderr = err.stderr ?? "";
          const firstOutput = [firstStderr, firstStdout].filter(Boolean).join("\n");

          if (!shouldRetryWithoutDangerousPermissions(firstOutput)) {
            throw err;
          }

          const retryResult = await execFileWithClosedStdin(cliPath, bypassPermissionArgs, {
            timeout: options.timeoutMs ?? 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: childEnv,
          });
          stdout = retryResult.stdout;
          stderr = retryResult.stderr;
        }

        const envelope = extractJson(stdout) as Record<string, unknown>;
        const isError = Boolean(envelope.is_error);
        const payload = envelope.structured_output ?? envelope.result;
        const result = typeof payload === "string"
          ? payload
          : JSON.stringify(payload);

        return {
          result,
          is_error: isError,
          raw_stdout: stdout,
          raw_stderr: stderr,
        };
      } catch (err: any) {
        const stderr = err.stderr ?? "";
        const stdout = err.stdout ?? "";
        const output = [stderr, stdout].filter(Boolean).join("\n");

        if (detectRateLimit(err.code ?? 1, output)) {
          const error = new Error("Rate limit hit") as any;
          error.isRateLimit = true;
          error.stderr = output;
          throw error;
        }
        if (output) {
          throw new Error(`${err.message}\n${output}`);
        }
        throw err;
      }
    },
  };
}

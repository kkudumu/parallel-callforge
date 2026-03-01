import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliProvider, CliInvokeOptions, CliResult } from "./types.js";
import { extractJson, detectRateLimit } from "./types.js";

const execFileAsync = promisify(execFile);

function shouldRetryWithoutDangerousPermissions(output: string): boolean {
  return /--dangerously-skip-permissions cannot be used with root\/sudo privileges/i.test(output);
}

export function createClaudeCli(cliPath: string): CliProvider {
  return {
    name: "claude",

    async invoke(options: CliInvokeOptions): Promise<CliResult> {
      const baseArgs = ["-p", "--output-format", "json"];
      const bypassPermissionArgs = ["--permission-mode", "bypassPermissions", ...baseArgs];
      const args = ["--dangerously-skip-permissions", ...baseArgs];

      if (options.jsonSchema) {
        args.push("--json-schema", options.jsonSchema);
      }

      if (options.maxTurns) {
        args.push("--max-turns", String(options.maxTurns));
      }

      // Prompt must be the last positional argument
      args.push(options.prompt);

      try {
        // Remove CLAUDECODE to avoid "cannot launch inside another session" error
        const childEnv: Record<string, string | undefined> = { ...process.env, IS_SANDBOX: "1" };
        delete childEnv.CLAUDECODE;
        let stdout = "";
        let stderr = "";

        try {
          const result = await execFileAsync(cliPath, args, {
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

          const retryResult = await execFileAsync(cliPath, [...bypassPermissionArgs, ...args.slice(4)], {
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

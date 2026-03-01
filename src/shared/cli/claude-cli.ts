import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliProvider, CliInvokeOptions, CliResult } from "./types.js";
import { extractJson, detectRateLimit } from "./types.js";

const execFileAsync = promisify(execFile);

export function createClaudeCli(cliPath: string): CliProvider {
  return {
    name: "claude",

    async invoke(options: CliInvokeOptions): Promise<CliResult> {
      const args = [
        "--dangerously-skip-permissions",
        "-p",
        "--output-format", "json",
      ];

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

        const { stdout, stderr } = await execFileAsync(cliPath, args, {
          timeout: options.timeoutMs ?? 120_000,
          maxBuffer: 10 * 1024 * 1024,
          env: childEnv,
        });

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
        if (detectRateLimit(err.code ?? 1, stderr)) {
          const error = new Error("Rate limit hit") as any;
          error.isRateLimit = true;
          error.stderr = stderr;
          throw error;
        }
        if (stderr) {
          throw new Error(`${err.message}\n${stderr}`);
        }
        throw err;
      }
    },
  };
}

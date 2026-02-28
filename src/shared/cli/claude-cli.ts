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
        "-p", options.prompt,
        "--output-format", "json",
      ];

      if (options.jsonSchema) {
        args.push("--json-schema", options.jsonSchema);
      }

      if (options.maxTurns) {
        args.push("--max-turns", String(options.maxTurns));
      }

      try {
        const { stdout, stderr } = await execFileAsync(cliPath, args, {
          timeout: options.timeoutMs ?? 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const envelope = extractJson(stdout) as Record<string, unknown>;
        const isError = Boolean(envelope.is_error);
        const result = typeof envelope.result === "string"
          ? envelope.result
          : JSON.stringify(envelope.result);

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
        throw err;
      }
    },
  };
}

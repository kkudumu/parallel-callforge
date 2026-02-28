import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliProvider, CliInvokeOptions, CliResult } from "./types.js";
import { extractJson, detectRateLimit } from "./types.js";

const execFileAsync = promisify(execFile);

export function createCodexCli(cliPath: string): CliProvider {
  return {
    name: "codex",

    async invoke(options: CliInvokeOptions): Promise<CliResult> {
      const args = [
        "-q",
        "--json",
        options.prompt,
      ];

      try {
        const { stdout, stderr } = await execFileAsync(cliPath, args, {
          timeout: options.timeoutMs ?? 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const parsed = extractJson(stdout);
        const result = typeof parsed === "string" ? parsed : JSON.stringify(parsed);

        return {
          result,
          is_error: false,
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

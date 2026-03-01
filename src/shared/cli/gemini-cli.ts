import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliProvider, CliInvokeOptions, CliResult } from "./types.js";
import { extractJson, detectRateLimit } from "./types.js";

const execFileAsync = promisify(execFile);

export function createGeminiCli(cliPath: string): CliProvider {
  return {
    name: "gemini",

    async invoke(options: CliInvokeOptions): Promise<CliResult> {
      const args = ["--yolo", "-o", "json"];

      const prompt = options.jsonSchema
        ? `${options.prompt}\n\nJSON Schema:\n${options.jsonSchema}\n\nOutput ONLY valid JSON matching this schema.`
        : options.prompt;

      args.push(prompt);

      try {
        const { stdout, stderr } = await execFileAsync(cliPath, args, {
          timeout: options.timeoutMs ?? 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const envelope = extractJson(stdout) as Record<string, unknown>;
        const payload = typeof envelope.response === "string"
          ? envelope.response
          : envelope;

        return {
          result: typeof payload === "string" ? payload : JSON.stringify(payload),
          is_error: false,
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

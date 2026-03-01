import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliProvider, CliInvokeOptions, CliResult } from "./types.js";
import { extractJson, detectRateLimit } from "./types.js";

const execFileAsync = promisify(execFile);

export function isCodexSchemaCompatible(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") {
    return true;
  }

  const node = schema as Record<string, unknown>;

  if ("propertyNames" in node) {
    return false;
  }

  if (node.type === "object" && node.additionalProperties !== false) {
    return false;
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isCodexSchemaCompatible(item)) {
          return false;
        }
      }
      continue;
    }

    if (!isCodexSchemaCompatible(value)) {
      return false;
    }
  }

  return true;
}

export function createCodexCli(cliPath: string): CliProvider {
  return {
    name: "codex",

    async invoke(options: CliInvokeOptions): Promise<CliResult> {
      const args = [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--json",
      ];

      if (options.jsonSchema) {
        const parsedSchema = JSON.parse(options.jsonSchema) as unknown;

        if (isCodexSchemaCompatible(parsedSchema)) {
          // Codex expects the schema on disk.
          const fs = await import("node:fs");
          const os = await import("node:os");
          const path = await import("node:path");
          const schemaPath = path.join(os.tmpdir(), `codex-schema-${Date.now()}.json`);
          fs.writeFileSync(schemaPath, options.jsonSchema);
          args.push("--output-schema", schemaPath);
        }
      }

      args.push(options.prompt);

      try {
        const { stdout, stderr } = await execFileAsync(cliPath, args, {
          timeout: options.timeoutMs ?? 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const lines = stdout.split(/\r?\n/).filter(Boolean);
        const events = lines
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean) as Array<Record<string, any>>;

        let structuredOutput: unknown = null;
        let resultText: string | null = null;
        for (let i = events.length - 1; i >= 0; i--) {
          const evt = events[i];
          if (evt?.type === "result" && evt.structured_output !== undefined) {
            structuredOutput = evt.structured_output;
            break;
          }
          if (evt?.type === "item.completed" && typeof evt?.item?.text === "string") {
            resultText = evt.item.text;
            break;
          }
        }

        const parsed =
          structuredOutput ??
          resultText ??
          extractJson(stdout);
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
        if (stderr) {
          throw new Error(`${err.message}\n${stderr}`);
        }
        throw err;
      }
    },
  };
}

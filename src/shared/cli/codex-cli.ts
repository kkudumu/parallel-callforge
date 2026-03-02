import type { CliProvider, CliInvokeOptions, CliResult } from "./types.js";
import { extractJson, detectRateLimit } from "./types.js";
import { runCliCommand } from "./run-command.js";

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

  if (node.type === "object" && node.properties && typeof node.properties === "object") {
    const propertyKeys = Object.keys(node.properties as Record<string, unknown>);
    const required = Array.isArray(node.required) ? node.required : null;

    if (!required) {
      return false;
    }

    if (required.length !== propertyKeys.length) {
      return false;
    }

    const requiredSet = new Set(required.filter((value): value is string => typeof value === "string"));
    if (requiredSet.size !== propertyKeys.length) {
      return false;
    }

    for (const key of propertyKeys) {
      if (!requiredSet.has(key)) {
        return false;
      }
    }
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
        "--full-auto",
        "--json",
      ];
      let schemaPath: string | null = null;
      let prompt = options.prompt;

      if (options.jsonSchema) {
        const parsedSchema = JSON.parse(options.jsonSchema) as unknown;

        if (isCodexSchemaCompatible(parsedSchema)) {
          // Codex expects the schema on disk.
          const fs = await import("node:fs");
          const os = await import("node:os");
          const path = await import("node:path");
          schemaPath = path.join(os.tmpdir(), `codex-schema-${Date.now()}.json`);
          fs.writeFileSync(schemaPath, options.jsonSchema);
          args.push("--output-schema", schemaPath);
        } else {
          prompt = `${options.prompt}\n\nJSON Schema:\n${options.jsonSchema}\n\nOutput ONLY valid JSON matching this schema.`;
        }
      }

      args.push(prompt);

      try {
        const { stdout, stderr } = await runCliCommand(cliPath, args, {
          timeoutMs: options.timeoutMs ?? 120_000,
          maxBuffer: 10 * 1024 * 1024,
          onOutput: options.onOutput,
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
      } finally {
        if (schemaPath) {
          const fs = await import("node:fs");
          fs.rmSync(schemaPath, { force: true });
        }
      }
    },
  };
}

import { z } from "zod/v4";
import type { CliProvider, ModelTier } from "./types.js";
import type { RateLimiters } from "./rate-limiter.js";
import { extractJson } from "./types.js";

export interface LlmCallOptions<T extends z.ZodType> {
  prompt: string;
  schema: T;
  maxRetries?: number;
  maxTurns?: number;
  timeoutMs?: number;
  model?: ModelTier;
  logLabel?: string;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

export interface LlmClient {
  call<T extends z.ZodType>(options: LlmCallOptions<T>): Promise<z.infer<T>>;
}

function summarizeError(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message.split("\n")[0];
  }

  return String(err);
}

function formatErrorDetails(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }

  return String(err);
}

function parseStructuredResult(result: string | unknown): unknown {
  if (typeof result !== "string") {
    return result;
  }

  try {
    return JSON.parse(result);
  } catch {
    return extractJson(result);
  }
}

/**
 * Coerce string-encoded numbers to actual numbers in parsed output.
 * LLMs sometimes return "85" instead of 85 for numeric fields.
 */
function coerceNumericStrings(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(coerceNumericStrings);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
        result[key] = Number(value.trim());
      } else {
        result[key] = coerceNumericStrings(value);
      }
    }
    return result;
  }
  return obj;
}

/**
 * If the LLM returns a bare array but the schema expects an object wrapper,
 * try wrapping it. Inspects the schema to find a single array property.
 */
function tryWrapBareArray<T extends z.ZodType>(parsed: unknown, schema: T): unknown {
  if (!Array.isArray(parsed)) return parsed;

  // Check if the schema is an object with a single array property
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const properties = jsonSchema.properties as Record<string, any> | undefined;
  if (!properties) return parsed;

  const arrayKeys = Object.keys(properties).filter(
    (k) => properties[k]?.type === "array"
  );
  if (arrayKeys.length === 1) {
    return { [arrayKeys[0]]: parsed };
  }
  return parsed;
}

function summarizeProgressLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;

    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }

    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }

    if (parsed.type === "item.completed") {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (item && typeof item.text === "string" && item.text.trim()) {
        return item.text.trim();
      }
    }

    if (parsed.type === "result" && parsed.structured_output) {
      return "Structured output received";
    }

    if (typeof parsed.type === "string") {
      return `event: ${parsed.type}`;
    }
  } catch {
    return trimmed;
  }

  return null;
}

function createProgressLogger(
  logLabel: string | undefined,
  model: ModelTier | undefined,
  onOutput: ((chunk: string, stream: "stdout" | "stderr") => void) | undefined
) {
  const partials = new Map<string, string>();
  const startedAt = Date.now();
  const heartbeat = logLabel
    ? setInterval(() => {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        console.log(`${logLabel} still running... ${elapsedSeconds}s elapsed`);
      }, 5000)
    : null;

  if (logLabel) {
    console.log(`${logLabel} started${model ? ` (${model})` : ""}`);
  }

  return {
    isVerbose: Boolean(logLabel),
    announceAttempt(providerName: string, attempt: number, maxRetries: number) {
      if (!logLabel) {
        return;
      }

      console.log(
        `${logLabel} invoking ${providerName} (attempt ${attempt}/${maxRetries})`
      );
    },
    onProviderOutput(
      providerName: string,
      chunk: string,
      stream: "stdout" | "stderr"
    ) {
      onOutput?.(chunk, stream);

      if (!logLabel) {
        return;
      }

      const key = `${providerName}:${stream}`;
      const combined = `${partials.get(key) ?? ""}${chunk}`;
      const lines = combined.split(/\r?\n/);
      partials.set(key, lines.pop() ?? "");

      for (const line of lines) {
        const summary = summarizeProgressLine(line);
        if (!summary) {
          continue;
        }

        if (stream === "stderr") {
          console.warn(`${logLabel} [${providerName}] ${summary}`);
        } else {
          console.log(`${logLabel} [${providerName}] ${summary}`);
        }
      }
    },
    validationFailed(providerName: string, attempt: number, maxRetries: number, errMsg: string) {
      if (!logLabel) {
        return;
      }

      console.warn(
        `${logLabel} [${providerName}] validation failed (attempt ${attempt}/${maxRetries}): ${errMsg}`
      );
    },
    finish(status: "completed" | "failed") {
      if (heartbeat) {
        clearInterval(heartbeat);
      }

      if (!logLabel) {
        return;
      }

      for (const [key, remainder] of partials.entries()) {
        const summary = summarizeProgressLine(remainder);
        if (!summary) {
          continue;
        }

        const [, stream] = key.split(":");
        if (stream === "stderr") {
          console.warn(`${logLabel} ${summary}`);
        } else {
          console.log(`${logLabel} ${summary}`);
        }
      }

      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      console.log(`${logLabel} ${status} in ${elapsedSeconds}s`);
    },
  };
}

async function invokeWithValidation<T extends z.ZodType>(
  provider: CliProvider,
  prompt: string,
  schema: T,
  maxRetries: number,
  maxTurns?: number,
  timeoutMs?: number,
  model?: ModelTier,
  progressLogger?: ReturnType<typeof createProgressLogger>
): Promise<z.infer<T>> {
  // Strip $schema meta-field – Claude CLI's --json-schema expects a plain
  // JSON Schema object without the dialect identifier that Zod v4 adds.
  const rawSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete rawSchema.$schema;
  const jsonSchema = JSON.stringify(rawSchema);
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    progressLogger?.announceAttempt(provider.name, attempt, maxRetries);
    const result = await provider.invoke({
      prompt: currentPrompt,
      jsonSchema,
      maxTurns: maxTurns ?? 10,
      timeoutMs,
      model,
      onOutput: (chunk, stream) =>
        progressLogger?.onProviderOutput(provider.name, chunk, stream),
    });

    if (result.is_error) {
      throw new Error(`CLI returned error: ${result.result}`);
    }

    try {
      let parsed = parseStructuredResult(result.result);
      parsed = tryWrapBareArray(parsed, schema);
      parsed = coerceNumericStrings(parsed);
      return schema.parse(parsed);
    } catch (err) {
      if (attempt >= maxRetries) throw err;

      const errMsg =
        err instanceof z.ZodError
          ? err.issues
              .map((i: any) => `Path "${(i.path || []).join(".")}": ${i.message}`)
              .join("\n")
          : String(err);

      currentPrompt = `${prompt}\n\nCORRECTION (attempt ${attempt + 1}):\nThe previous output failed validation:\n${errMsg}\nOutput ONLY valid JSON matching the schema.`;

      progressLogger?.validationFailed(provider.name, attempt, maxRetries, errMsg);

      if (!progressLogger || !progressLogger.isVerbose) {
        console.warn(
          `[${provider.name}] Validation failed (attempt ${attempt}/${maxRetries}): ${errMsg}`
        );
      }
    }
  }

  throw new Error("Unreachable");
}

export function createLlmClient(
  primary: CliProvider,
  fallback: CliProvider,
  limiters: RateLimiters,
  tertiary?: CliProvider
): LlmClient {
  return {
    async call<T extends z.ZodType>(options: LlmCallOptions<T>): Promise<z.infer<T>> {
      const {
        prompt,
        schema,
        maxRetries = 3,
        maxTurns,
        timeoutMs,
        model,
        logLabel,
        onOutput,
      } = options;
      const progressLogger = createProgressLogger(logLabel, model, onOutput);
      const providers = [
        { role: "Primary", provider: primary, limiter: limiters.claude },
        { role: "Fallback", provider: fallback, limiter: limiters.codex },
        ...(tertiary
          ? [{ role: "Tertiary", provider: tertiary, limiter: limiters.gemini }]
          : []),
      ];
      const failures: string[] = [];

      for (let i = 0; i < providers.length; i++) {
        const current = providers[i];

        try {
          const result = await current.limiter.schedule(() =>
            invokeWithValidation(
              current.provider,
              prompt,
              schema,
              maxRetries,
              maxTurns,
              timeoutMs,
              model,
              progressLogger
            )
          );
          progressLogger.finish("completed");
          return result;
        } catch (err: any) {
          const errorSummary = summarizeError(err);
          const errorDetails = formatErrorDetails(err);
          failures.push(`${current.role} (${current.provider.name}): ${errorSummary}`);
          const next = providers[i + 1];
          if (next) {
            console.warn(
              `[${current.provider.name}] Failed, falling back to ${next.provider.name}: ${errorSummary}`
            );
            if (errorDetails !== errorSummary) {
              console.warn(
                `[${current.provider.name}] Failure details before fallback:\n${errorDetails}`
              );
            }
            continue;
          }
        }
      }

      progressLogger.finish("failed");
      throw new Error(`All providers failed. ${failures.join(". ")}`);
    },
  };
}

import { z } from "zod/v4";
import type { CliProvider } from "./types.js";
import type { RateLimiters } from "./rate-limiter.js";

export interface LlmCallOptions<T extends z.ZodType> {
  prompt: string;
  schema: T;
  maxRetries?: number;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface LlmClient {
  call<T extends z.ZodType>(options: LlmCallOptions<T>): Promise<z.infer<T>>;
}

async function invokeWithValidation<T extends z.ZodType>(
  provider: CliProvider,
  prompt: string,
  schema: T,
  maxRetries: number,
  maxTurns?: number,
  timeoutMs?: number
): Promise<z.infer<T>> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await provider.invoke({
      prompt: currentPrompt,
      jsonSchema,
      maxTurns: maxTurns ?? 10,
      timeoutMs,
    });

    if (result.is_error) {
      throw new Error(`CLI returned error: ${result.result}`);
    }

    try {
      const parsed = typeof result.result === "string"
        ? JSON.parse(result.result)
        : result.result;
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

      console.warn(
        `[${provider.name}] Validation failed (attempt ${attempt}/${maxRetries}): ${errMsg}`
      );
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
      const { prompt, schema, maxRetries = 3, maxTurns, timeoutMs } = options;
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
          return await current.limiter.schedule(() =>
            invokeWithValidation(
              current.provider,
              prompt,
              schema,
              maxRetries,
              maxTurns,
              timeoutMs
            )
          );
        } catch (err: any) {
          failures.push(`${current.role} (${current.provider.name}): ${err.message}`);
          const next = providers[i + 1];
          if (next) {
            console.warn(
              `[${current.provider.name}] Failed, falling back to ${next.provider.name}: ${err.message}`
            );
            continue;
          }
        }
      }

      throw new Error(`All providers failed. ${failures.join(". ")}`);
    },
  };
}

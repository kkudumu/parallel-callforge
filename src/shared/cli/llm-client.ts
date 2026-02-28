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
  limiters: RateLimiters
): LlmClient {
  return {
    async call<T extends z.ZodType>(options: LlmCallOptions<T>): Promise<z.infer<T>> {
      const { prompt, schema, maxRetries = 3, maxTurns, timeoutMs } = options;

      // Try primary provider through rate limiter
      try {
        return await limiters.claude.schedule(() =>
          invokeWithValidation(primary, prompt, schema, maxRetries, maxTurns, timeoutMs)
        );
      } catch (primaryErr: any) {
        console.warn(
          `[${primary.name}] Failed, falling back to ${fallback.name}: ${primaryErr.message}`
        );

        // Try fallback provider
        try {
          return await limiters.codex.schedule(() =>
            invokeWithValidation(
              fallback,
              prompt,
              schema,
              maxRetries,
              maxTurns,
              timeoutMs
            )
          );
        } catch (fallbackErr: any) {
          const error = new Error(
            `All providers failed. Primary (${primary.name}): ${primaryErr.message}. Fallback (${fallback.name}): ${fallbackErr.message}`
          );
          throw error;
        }
      }
    },
  };
}

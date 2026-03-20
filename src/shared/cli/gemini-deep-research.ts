import { createGeminiCli } from "./gemini-cli.js";

export async function runGeminiSingleResearch(
  geminiPath: string,
  prompt: string,
  options: { timeoutMs?: number; logPrefix: string }
): Promise<void> {
  const gemini = createGeminiCli(geminiPath);
  const timeoutMs = options.timeoutMs ?? 12 * 60_000;

  console.log(`${options.logPrefix} Starting Gemini single research`);
  await gemini.invoke({ prompt, timeoutMs });
  console.log(`${options.logPrefix} Gemini single research completed`);
}

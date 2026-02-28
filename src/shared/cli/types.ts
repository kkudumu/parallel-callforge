import type { z } from "zod/v4";

export interface CliInvokeOptions {
  prompt: string;
  jsonSchema?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface CliResult {
  result: string;
  is_error: boolean;
  raw_stdout: string;
  raw_stderr: string;
}

export interface CliProvider {
  name: string;
  invoke(options: CliInvokeOptions): Promise<CliResult>;
}

export function detectRateLimit(exitCode: number | null, stderr: string): boolean {
  const patterns = [
    /rate.?limit/i,
    /429/,
    /too many requests/i,
    /rate_limit_exceeded/i,
    /Please try again in/i,
  ];
  return exitCode !== 0 && patterns.some((p) => p.test(stderr));
}

export function parseRetryAfter(stderr: string): number {
  const match = stderr.match(/try again in ([\d.]+)\s*s(?:econds?)?/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) + 1000 : 30_000;
}

export function extractJson(stdout: string): unknown {
  // Strategy 1: Direct parse
  try {
    return JSON.parse(stdout);
  } catch { /* continue */ }

  // Strategy 2: Extract from markdown code block
  const codeBlockMatch = stdout.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch { /* continue */ }
  }

  // Strategy 3: Try parsing from each { or [ to end, shrinking window
  for (let i = 0; i < stdout.length; i++) {
    if (stdout[i] === "{" || stdout[i] === "[") {
      for (let j = stdout.length; j > i; j--) {
        try {
          return JSON.parse(stdout.slice(i, j));
        } catch { /* continue */ }
      }
    }
  }

  throw new Error("No valid JSON found in CLI output");
}

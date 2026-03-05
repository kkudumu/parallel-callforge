import { readFileSync, existsSync } from "node:fs";

const MIN_WORD_COUNT = 500;

export function readResearchFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function validateResearchFile(content: string): boolean {
  if (!content.includes("## Source Index")) return false;
  const words = content.trim().split(/\s+/).length;
  if (words < MIN_WORD_COUNT) return false;
  return true;
}

export function buildResearchContext(
  files: Record<string, string | null>
): string {
  return Object.entries(files)
    .filter(([, content]) => content !== null)
    .map(([key, content]) => `=== ${key.toUpperCase()} RESEARCH ===\n\n${content}`)
    .join("\n\n---\n\n");
}

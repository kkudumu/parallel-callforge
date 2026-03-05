import { readFileSync, existsSync } from "node:fs";

const MIN_WORD_COUNT = 500;
const REQUIRED_HEADERS = [
  /^# .+ Research — .+/m,
  /^## Key Findings$/m,
  /^## Source Index$/m,
];

export function readResearchFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function validateResearchFile(content: string): boolean {
  for (const header of REQUIRED_HEADERS) {
    if (!header.test(content)) return false;
  }

  const words = content.trim().split(/\s+/).length;
  if (words < MIN_WORD_COUNT) return false;

  const findingBlocks = content.match(
    /###\s+.+\n[\s\S]*?\*\*Evidence:\*\*\s+.+\n\*\*Data:\*\*\s+.+\n\*\*Implication:\*\*\s+.+/g
  );
  if (!findingBlocks || findingBlocks.length === 0) return false;

  const sourceLines = content.match(/^-\s+\S+/gm);
  if (!sourceLines || sourceLines.length === 0) return false;

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

// Re-export Agent 2's reader functions — the research file format is identical.
export {
  readResearchFile,
  validateResearchFile,
  buildResearchContext,
} from "../agent-2-design/research-reader.js";

export const RESEARCH_FILE_NAMES_A1 = [
  "keyword-patterns.md",
  "market-data.md",
  "competitor-keywords.md",
  "local-seo.md",
  "ppc-economics.md",
  "gbp-competition.md",
] as const;

const REQUIRED_PLAYBOOK_SECTIONS = [
  /^## Executive Summary$/m,
  /^## Market Sizing & Economics$/m,
  /^## Two-Pipeline Candidate Logic$/m,
  /^## Climate & Pest Pressure Scoring$/m,
  /^## Competition Scoring Model$/m,
  /^## Keyword Patterns & Intent Classification$/m,
  /^## Competitor URL Patterns$/m,
  /^## Pay-Per-Call Economics$/m,
  /^## Red Flags: Auto-Disqualify Signals$/m,
  /^## Free Tool Stack$/m,
  /^## Source Index$/m,
];

export function validatePlaybookFile(content: string): boolean {
  return REQUIRED_PLAYBOOK_SECTIONS.every((pattern) => pattern.test(content));
}

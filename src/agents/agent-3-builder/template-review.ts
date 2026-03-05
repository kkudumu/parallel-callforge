export interface GeneratedHugoTemplates {
  baseof: string;
  city_hub: string;
  service_subpage: string;
}

interface DefineBlock {
  name: string;
  fullStart: number;
  bodyStart: number;
  bodyEnd: number;
  fullEnd: number;
  depth: number;
}

function parseDefineBlocks(source: string): DefineBlock[] {
  const tokenRe = /{{\s*define\s+"([^"]+)"\s*}}|{{\s*(if|range|with|block)\b[^}]*}}|{{\s*end\s*}}/g;
  const stack: Array<{
    type: "define" | "control";
    name: string;
    fullStart: number;
    bodyStart: number;
    depth: number;
  }> = [];
  const blocks: DefineBlock[] = [];

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(source)) !== null) {
    const [token, defineName, controlType] = match;
    if (defineName) {
      stack.push({
        type: "define",
        name: defineName,
        fullStart: match.index,
        bodyStart: match.index + token.length,
        depth: stack.length,
      });
      continue;
    }

    if (controlType) {
      stack.push({
        type: "control",
        name: controlType,
        fullStart: match.index,
        bodyStart: match.index + token.length,
        depth: stack.length,
      });
      continue;
    }

    const frame = stack.pop();
    if (!frame) {
      continue;
    }

    if (frame.type !== "define") {
      continue;
    }

    blocks.push({
      name: frame.name,
      fullStart: frame.fullStart,
      bodyStart: frame.bodyStart,
      bodyEnd: match.index,
      fullEnd: tokenRe.lastIndex,
      depth: frame.depth,
    });
  }

  if (stack.length > 0) {
    throw new Error(`Unclosed Hugo define block(s): ${stack.map((entry) => entry.name).join(", ")}`);
  }

  return blocks;
}

function stripNestedDefineBlocks(source: string, block: DefineBlock, allBlocks: DefineBlock[]): string {
  let body = source.slice(block.bodyStart, block.bodyEnd);
  const nested = allBlocks
    .filter(
      (candidate) =>
        candidate.fullStart >= block.bodyStart &&
        candidate.fullEnd <= block.bodyEnd
    )
    .sort((a, b) => b.fullStart - a.fullStart);

  for (const candidate of nested) {
    const start = candidate.fullStart - block.bodyStart;
    const end = candidate.fullEnd - block.bodyStart;
    body = body.slice(0, start) + body.slice(end);
  }

  return body.trim();
}

function normalizeBaseofTemplate(source: string): string {
  const blocks = parseDefineBlocks(source);
  const baseofBlock = blocks.find((block) => block.name === "baseof" && block.depth === 0);
  if (!baseofBlock) {
    return source.trim();
  }

  return stripNestedDefineBlocks(source, baseofBlock, blocks);
}

function normalizeChildTemplate(source: string): string {
  const blocks = parseDefineBlocks(source);
  if (blocks.length === 0) {
    return source.trim();
  }

  const orderedNames = ["main", "head", "schema", "sticky-call-bar"];
  const selected = new Map<string, DefineBlock>();

  for (const name of orderedNames) {
    const match = blocks.find((block) => block.name === name);
    if (match) {
      selected.set(name, match);
    }
  }

  for (const block of blocks) {
    if (!selected.has(block.name)) {
      selected.set(block.name, block);
    }
  }

  if (!selected.has("main")) {
    throw new Error("Generated Hugo child template is missing a main define block");
  }

  return Array.from(selected.entries())
    .map(([name, block]) => {
      const body = stripNestedDefineBlocks(source, block, blocks);
      return `{{ define "${name}" }}\n${body}\n{{ end }}`;
    })
    .join("\n\n");
}

function countNestedBlocksInsideMain(source: string): number {
  const blocks = parseDefineBlocks(source);
  const mainBlock = blocks.find((block) => block.name === "main");
  if (!mainBlock) {
    return 0;
  }

  return blocks.filter(
    (block) =>
      block.name !== "main" &&
      block.fullStart >= mainBlock.bodyStart &&
      block.fullEnd <= mainBlock.bodyEnd
  ).length;
}

// Fix `{{ range first N .Params.X }}` which crashes when .Params.X is nil.
// Replace with `{{ range first N (default slice .Params.X) }}` so nil becomes [].
function fixNilSliceFirstCalls(source: string): { result: string; fixed: boolean } {
  const pattern = /{{\s*range\s+first\s+(\d+)\s+(\.Params\.\w+)\s*}}/g;
  const result = source.replace(pattern, (_, n, param) => `{{ range first ${n} (default slice ${param}) }}`);
  return { result, fixed: result !== source };
}

// Known partial name aliases: LLM sometimes invents wrong names.
const PARTIAL_ALIASES: Record<string, string> = {
  "schema.json": "schema-jsonld.html",
  "schema.html": "schema-jsonld.html",
  "schema-json.html": "schema-jsonld.html",
  "json-ld.html": "schema-jsonld.html",
  "jsonld.html": "schema-jsonld.html",
  "head.html": "header.html",
  "sticky-cta.html": "cta-sticky.html",
  "sticky_cta.html": "cta-sticky.html",
  "cta_sticky.html": "cta-sticky.html",
  "cta_badge.html": "cta-badge.html",
};

function fixPartialNames(source: string): { result: string; fixed: boolean } {
  let result = source;
  for (const [wrong, correct] of Object.entries(PARTIAL_ALIASES)) {
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`partial\\s+"${escaped}"`, "g");
    result = result.replace(pattern, `partial "${correct}"`);
  }
  return { result, fixed: result !== source };
}

const THEME_STYLESHEET_LINK = '<link rel="stylesheet" href="/css/generated-theme.css">';

function ensureStylesheetLink(source: string): { result: string; fixed: boolean } {
  if (source.includes('/css/generated-theme.css')) {
    return { result: source, fixed: false };
  }

  // Inject before </head> if present
  if (/<\/head>/i.test(source)) {
    const result = source.replace(/<\/head>/i, `  ${THEME_STYLESHEET_LINK}\n</head>`);
    return { result, fixed: true };
  }

  // If no </head> tag, inject after the last <meta> or <title> tag
  const matches = [...source.matchAll(/<(?:meta|title)[^>]*>/gi)];
  if (matches.length > 0) {
    const lastMatch = matches[matches.length - 1];
    const insertPos = lastMatch.index! + lastMatch[0].length;
    const result = source.slice(0, insertPos) + `\n  ${THEME_STYLESHEET_LINK}` + source.slice(insertPos);
    return { result, fixed: true };
  }

  return { result: source, fixed: false };
}

export function reviewGeneratedHugoTemplates(
  templates: GeneratedHugoTemplates
): { templates: GeneratedHugoTemplates; repairsApplied: string[] } {
  const repairsApplied: string[] = [];

  // Fix nil-slice first calls across all templates before structural normalization
  const baseofFixed = fixNilSliceFirstCalls(templates.baseof);
  const cityHubFixed = fixNilSliceFirstCalls(templates.city_hub);
  const serviceSubpageFixed = fixNilSliceFirstCalls(templates.service_subpage);
  if (baseofFixed.fixed || cityHubFixed.fixed || serviceSubpageFixed.fixed) {
    repairsApplied.push("nil_slice_first_calls_fixed");
  }

  // Fix incorrect partial names generated by the LLM
  const baseofPartialFixed = fixPartialNames(baseofFixed.result);
  const cityHubPartialFixed = fixPartialNames(cityHubFixed.result);
  const serviceSubpagePartialFixed = fixPartialNames(serviceSubpageFixed.result);
  if (baseofPartialFixed.fixed || cityHubPartialFixed.fixed || serviceSubpagePartialFixed.fixed) {
    repairsApplied.push("partial_names_corrected");
  }

  // Ensure baseof.html links to the generated theme stylesheet
  const baseofStyleFixed = ensureStylesheetLink(baseofPartialFixed.result);
  if (baseofStyleFixed.fixed) {
    repairsApplied.push("baseof_stylesheet_link_injected");
  }
  const repairedBaseof = baseofStyleFixed.result;
  const repairedCityHub = cityHubPartialFixed.result;
  const repairedServiceSubpage = serviceSubpagePartialFixed.result;

  const normalizedBaseof = normalizeBaseofTemplate(repairedBaseof);
  if (normalizedBaseof !== repairedBaseof.trim()) {
    repairsApplied.push("baseof_wrapper_normalized");
  }

  const hubNestedCount = countNestedBlocksInsideMain(repairedCityHub);
  const normalizedCityHub = normalizeChildTemplate(repairedCityHub);
  if (normalizedCityHub !== repairedCityHub.trim()) {
    repairsApplied.push(
      hubNestedCount > 0 ? "city_hub_nested_defines_hoisted" : "city_hub_normalized"
    );
  }

  const subNestedCount = countNestedBlocksInsideMain(repairedServiceSubpage);
  const normalizedServiceSubpage = normalizeChildTemplate(repairedServiceSubpage);
  if (normalizedServiceSubpage !== repairedServiceSubpage.trim()) {
    repairsApplied.push(
      subNestedCount > 0 ? "service_subpage_nested_defines_hoisted" : "service_subpage_normalized"
    );
  }

  return {
    templates: {
      baseof: normalizedBaseof,
      city_hub: normalizedCityHub,
      service_subpage: normalizedServiceSubpage,
    },
    repairsApplied,
  };
}

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

export function reviewGeneratedHugoTemplates(
  templates: GeneratedHugoTemplates
): { templates: GeneratedHugoTemplates; repairsApplied: string[] } {
  const repairsApplied: string[] = [];

  const normalizedBaseof = normalizeBaseofTemplate(templates.baseof);
  if (normalizedBaseof !== templates.baseof.trim()) {
    repairsApplied.push("baseof_wrapper_normalized");
  }

  const hubNestedCount = countNestedBlocksInsideMain(templates.city_hub);
  const normalizedCityHub = normalizeChildTemplate(templates.city_hub);
  if (normalizedCityHub !== templates.city_hub.trim()) {
    repairsApplied.push(
      hubNestedCount > 0 ? "city_hub_nested_defines_hoisted" : "city_hub_normalized"
    );
  }

  const subNestedCount = countNestedBlocksInsideMain(templates.service_subpage);
  const normalizedServiceSubpage = normalizeChildTemplate(templates.service_subpage);
  if (normalizedServiceSubpage !== templates.service_subpage.trim()) {
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

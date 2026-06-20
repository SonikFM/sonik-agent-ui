export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type ChatTextBlock =
  | { kind: "paragraph"; tokens: InlineToken[] }
  | { kind: "heading"; level: 1 | 2 | 3 | 4; tokens: InlineToken[] }
  | { kind: "list"; ordered: boolean; items: InlineToken[][] }
  | { kind: "code"; language?: string; text: string }
  | { kind: "table"; headers: InlineToken[][]; rows: InlineToken[][][] };

function isSafeUrl(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value);
}

export function parseInline(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const matcher = /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;

  for (const match of value.matchAll(matcher)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ kind: "text", text: value.slice(cursor, index) });

    if (raw.startsWith("`") && raw.endsWith("`")) {
      tokens.push({ kind: "code", text: raw.slice(1, -1) });
    } else if (raw.startsWith("[")) {
      const link = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link?.[2]?.trim() ?? "";
      if (link?.[1] && isSafeUrl(href)) tokens.push({ kind: "link", text: link[1], href });
      else tokens.push({ kind: "text", text: link?.[1] ?? raw });
    } else if (raw.startsWith("**") && raw.endsWith("**")) {
      tokens.push({ kind: "strong", text: raw.slice(2, -2) });
    } else if (raw.startsWith("*") && raw.endsWith("*")) {
      tokens.push({ kind: "em", text: raw.slice(1, -1) });
    } else {
      tokens.push({ kind: "text", text: raw });
    }

    cursor = index + raw.length;
  }

  if (cursor < value.length) tokens.push({ kind: "text", text: value.slice(cursor) });
  return tokens;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseTable(lines: string[]): ChatTextBlock {
  const headerCells = splitTableRow(lines[0] ?? "").map(parseInline);
  const rows = lines.slice(2).map((line) => splitTableRow(line).map(parseInline));
  return { kind: "table", headers: headerCells, rows };
}

function collectTable(lines: string[], startIndex: number): { block: ChatTextBlock; nextIndex: number } | null {
  if (!lines[startIndex]?.includes("|") || !isTableSeparator(lines[startIndex + 1] ?? "")) return null;

  let cursor = startIndex + 2;
  while (cursor < lines.length && lines[cursor]?.includes("|") && lines[cursor]?.trim()) {
    cursor += 1;
  }

  return {
    block: parseTable(lines.slice(startIndex, cursor)),
    nextIndex: cursor,
  };
}

function parseList(lines: string[], startIndex: number): { block: ChatTextBlock; nextIndex: number } | null {
  const first = lines[startIndex] ?? "";
  const ordered = /^\s*\d+\.\s+/.test(first);
  const unordered = /^\s*[-*]\s+/.test(first);
  if (!ordered && !unordered) return null;

  const items: InlineToken[][] = [];
  let cursor = startIndex;
  const matcher = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*]\s+(.+)$/;
  while (cursor < lines.length) {
    const match = lines[cursor]?.match(matcher);
    if (!match) break;
    items.push(parseInline(match[1] ?? ""));
    cursor += 1;
  }

  return {
    block: { kind: "list", ordered, items },
    nextIndex: cursor,
  };
}

function parseCodeBlock(lines: string[], startIndex: number): { block: ChatTextBlock; nextIndex: number } | null {
  const first = lines[startIndex] ?? "";
  if (!first.trim().startsWith("```")) return null;

  const language = first.trim().slice(3).trim() || undefined;
  const body: string[] = [];
  let cursor = startIndex + 1;
  while (cursor < lines.length && !lines[cursor]?.trim().startsWith("```")) {
    body.push(lines[cursor] ?? "");
    cursor += 1;
  }

  return {
    block: { kind: "code", language, text: body.join("\n") },
    nextIndex: cursor < lines.length ? cursor + 1 : cursor,
  };
}

export function renderChatText(value: string): ChatTextBlock[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: ChatTextBlock[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    if (!line.trim()) {
      cursor += 1;
      continue;
    }

    const codeBlock = parseCodeBlock(lines, cursor);
    if (codeBlock) {
      blocks.push(codeBlock.block);
      cursor = codeBlock.nextIndex;
      continue;
    }

    const table = collectTable(lines, cursor);
    if (table) {
      blocks.push(table.block);
      cursor = table.nextIndex;
      continue;
    }

    const list = parseList(lines, cursor);
    if (list) {
      blocks.push(list.block);
      cursor = list.nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 2, 4) as 1 | 2 | 3 | 4;
      blocks.push({ kind: "heading", level, tokens: parseInline(heading[2] ?? "") });
      cursor += 1;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    cursor += 1;
    while (
      cursor < lines.length &&
      lines[cursor]?.trim() &&
      !lines[cursor]?.trim().startsWith("```") &&
      !lines[cursor]?.match(/^(#{1,4})\s+/) &&
      !lines[cursor]?.match(/^\s*([-*]|\d+\.)\s+/) &&
      !(lines[cursor]?.includes("|") && isTableSeparator(lines[cursor + 1] ?? ""))
    ) {
      paragraph.push(lines[cursor]?.trim() ?? "");
      cursor += 1;
    }
    blocks.push({ kind: "paragraph", tokens: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

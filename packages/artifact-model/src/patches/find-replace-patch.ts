import { replaceArtifactContent, type Artifact } from "../model/artifact.js";
import type { DocumentArtifact, DocumentArtifactContent } from "../model/document-artifact.js";

export interface FindReplacePatch {
  find: string;
  replace: string;
  all?: boolean;
  caseSensitive?: boolean;
}

export interface FindReplaceRange {
  start: number;
  end: number;
  replacementStart: number;
  replacementEnd: number;
  match: string;
}

export interface FindReplacePatchResult<TArtifact extends Artifact> {
  artifact: TArtifact;
  count: number;
  ranges: FindReplaceRange[];
}

export interface TextFindReplaceResult {
  text: string;
  count: number;
  ranges: FindReplaceRange[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyFindReplaceToText(
  text: string,
  { find, replace, all = true, caseSensitive = true }: FindReplacePatch,
): TextFindReplaceResult {
  if (find.length === 0) {
    return { text, count: 0, ranges: [] };
  }

  const flags = `g${caseSensitive ? "" : "i"}`;
  const matcher = new RegExp(escapeRegExp(find), flags);
  const ranges: FindReplaceRange[] = [];
  let nextText = "";
  let cursor = 0;
  let replacementOffset = 0;

  for (const match of text.matchAll(matcher)) {
    const start = match.index;
    const matched = match[0];
    const end = start + matched.length;
    const replacementStart = start + replacementOffset;
    const replacementEnd = replacementStart + replace.length;

    nextText += text.slice(cursor, start) + replace;
    cursor = end;
    replacementOffset += replace.length - matched.length;
    ranges.push({ start, end, replacementStart, replacementEnd, match: matched });

    if (!all) {
      break;
    }
  }

  if (ranges.length === 0) {
    return { text, count: 0, ranges: [] };
  }

  nextText += text.slice(cursor);
  return { text: nextText, count: ranges.length, ranges };
}

export function applyDocumentFindReplacePatch(
  artifact: DocumentArtifact,
  patch: FindReplacePatch,
  now?: string,
): FindReplacePatchResult<DocumentArtifact> {
  const result = applyFindReplaceToText(artifact.content.body, patch);

  if (result.count === 0) {
    return { artifact, count: 0, ranges: [] };
  }

  const nextContent: DocumentArtifactContent = {
    ...artifact.content,
    body: result.text,
  };

  return {
    artifact: replaceArtifactContent(artifact, nextContent, now) as DocumentArtifact,
    count: result.count,
    ranges: result.ranges,
  };
}

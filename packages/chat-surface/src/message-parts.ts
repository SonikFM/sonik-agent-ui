import { SPEC_DATA_PART_TYPE, type Spec } from "@json-render/core";
import {
  buildSpecFromParts,
  getTextFromParts,
  type DataPart,
} from "@json-render/svelte/utils";

export interface ToolInfo {
  toolCallId: string;
  toolName: string;
  state: string;
  output?: unknown;
  errorText?: string;
  /** True when a later tool call of the same name in this message succeeded. */
  recovered?: boolean;
}

export type ChatSegment =
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: ToolInfo[] }
  | { kind: "spec" };

export interface ChatSegmentsResult {
  segments: ChatSegment[];
  specInserted: boolean;
}

type ToolPartRecord = DataPart & {
  toolName?: unknown;
  toolCallId?: unknown;
  state?: unknown;
  input?: unknown;
  rawInput?: unknown;
  output?: unknown;
  errorText?: unknown;
};

const SPEC_PARAMETER_ENVELOPE =
  /(?:^|\r?\n)[\t ]*<?parameter[\t ]+name=(["'])spec\1[\t ]+string=/i;

function isFailedDynamicJsonArtifact(part: DataPart | undefined): boolean {
  if (!part || part.type !== "dynamic-tool") return false;
  const toolPart = part as ToolPartRecord;
  if (toolPart.toolName !== "createJsonArtifact" || toolPart.state !== "output-error") return false;
  return toolPart.input !== undefined || toolPart.rawInput !== undefined;
}

function visibleText(text: string, parts: DataPart[], index: number): string {
  const envelope = SPEC_PARAMETER_ENVELOPE.exec(text);
  if (!envelope) return text;
  if (!isFailedDynamicJsonArtifact(parts[index - 1]) && !isFailedDynamicJsonArtifact(parts[index + 1])) return text;

  // ponytail: This heuristic removes only a line-start `parameter name="spec"
  // string=` suffix directly beside a failed dynamic createJsonArtifact call
  // carrying input/rawInput. It never scans non-adjacent prose or generic
  // JSON/XML. If a provider appends legitimate prose after that envelope in the
  // same text part, this deliberately narrow matcher ceiling must be revisited.
  return text.slice(0, envelope.index).trimEnd();
}

function projectVisibleMessageParts(parts: DataPart[]): DataPart[] {
  return parts.flatMap((part, index) => {
    if (part.type !== "text" || typeof part.text !== "string") return [part];
    const text = visibleText(part.text, parts, index);
    return text ? [{ ...part, text }] : [];
  });
}

function normalizeToolPart(part: DataPart): ToolInfo | null {
  const toolPart = part as ToolPartRecord;
  const toolName =
    part.type === "dynamic-tool"
      ? toolPart.toolName
      : part.type.startsWith("tool-")
        ? part.type.replace(/^tool-/, "")
        : undefined;
  if (typeof toolName !== "string" || !toolName) return null;

  return {
    toolCallId: typeof toolPart.toolCallId === "string" ? toolPart.toolCallId : "",
    toolName,
    state: typeof toolPart.state === "string" ? toolPart.state : "",
    output: toolPart.output,
    errorText: typeof toolPart.errorText === "string" ? toolPart.errorText : undefined,
  };
}

export function snapshotDataParts(value: DataPart[] | null | undefined): DataPart[] {
  if (!Array.isArray(value)) return [];
  try {
    return structuredClone(value) as DataPart[];
  } catch {
    return JSON.parse(JSON.stringify(value)) as DataPart[];
  }
}

export function getSpec(parts: DataPart[]): Spec | null {
  return buildSpecFromParts(parts);
}

export function getText(parts: DataPart[]): string {
  return getTextFromParts(projectVisibleMessageParts(parts));
}

export function hasSpec(parts: DataPart[]): boolean {
  return parts.some((part) => part.type === SPEC_DATA_PART_TYPE);
}

export function getSegments(parts: DataPart[]): ChatSegmentsResult {
  const segments: ChatSegment[] = [];
  let specInserted = false;
  // Flat, message-order list of every tool call, kept alongside the segments
  // so a failed call can look ahead (across text/spec segments too) for a
  // later same-named call that succeeded -- Slice C's "recovered" signal.
  const allTools: ToolInfo[] = [];

  for (const part of projectVisibleMessageParts(parts)) {
    if (part.type === "text" && part.text) {
      const text = part.text;
      if (!text.trim()) continue;
      const last = segments[segments.length - 1];
      if (last?.kind === "text") {
        last.text += text;
      } else {
        segments.push({ kind: "text", text });
      }
    } else {
      const toolInfo = normalizeToolPart(part);
      if (toolInfo) {
        const last = segments[segments.length - 1];
        if (last?.kind === "tools") {
          last.tools.push(toolInfo);
        } else {
          segments.push({ kind: "tools", tools: [toolInfo] });
        }
        allTools.push(toolInfo);
      } else if (part.type === SPEC_DATA_PART_TYPE && !specInserted) {
        segments.push({ kind: "spec" });
        specInserted = true;
      }
    }
  }

  for (const [i, tool] of allTools.entries()) {
    if (tool.state !== "output-error" && tool.state !== "output-denied") continue;
    tool.recovered = allTools
      .slice(i + 1)
      .some((later) => later.toolName === tool.toolName && later.state === "output-available");
  }

  return { segments, specInserted };
}

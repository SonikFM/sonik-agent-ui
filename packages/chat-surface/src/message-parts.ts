import { SPEC_DATA_PART_TYPE } from "@json-render/core";
import {
  buildSpecFromParts,
  getTextFromParts,
  type DataPart,
  type Spec,
} from "@json-render/svelte";

export interface ToolInfo {
  toolCallId: string;
  toolName: string;
  state: string;
  output?: unknown;
  errorText?: string;
}

export type ChatSegment =
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: ToolInfo[] }
  | { kind: "spec" };

export interface ChatSegmentsResult {
  segments: ChatSegment[];
  specInserted: boolean;
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
  return getTextFromParts(parts);
}

export function hasSpec(parts: DataPart[]): boolean {
  return parts.some((part) => part.type === SPEC_DATA_PART_TYPE);
}

export function getSegments(parts: DataPart[]): ChatSegmentsResult {
  const segments: ChatSegment[] = [];
  let specInserted = false;

  for (const part of parts) {
    if (part.type === "text" && part.text) {
      const text = part.text;
      if (!text.trim()) continue;
      const last = segments[segments.length - 1];
      if (last?.kind === "text") {
        last.text += text;
      } else {
        segments.push({ kind: "text", text });
      }
    } else if (part.type.startsWith("tool-")) {
      const toolPart = part as {
        type: string;
        toolCallId?: string;
        state?: string;
        output?: unknown;
        errorText?: string;
      };
      const last = segments[segments.length - 1];
      const toolInfo: ToolInfo = {
        toolCallId: toolPart.toolCallId || "",
        toolName: toolPart.type.replace(/^tool-/, ""),
        state: toolPart.state || "",
        output: toolPart.output,
        errorText: toolPart.errorText,
      };
      if (last?.kind === "tools") {
        last.tools.push(toolInfo);
      } else {
        segments.push({ kind: "tools", tools: [toolInfo] });
      }
    } else if (part.type === SPEC_DATA_PART_TYPE && !specInserted) {
      segments.push({ kind: "spec" });
      specInserted = true;
    }
  }

  return { segments, specInserted };
}

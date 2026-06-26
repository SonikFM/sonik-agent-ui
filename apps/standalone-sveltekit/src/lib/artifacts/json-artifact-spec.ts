import type { Spec } from "@json-render/core";

export interface NormalizedJsonArtifactSpec {
  spec: Spec;
  recovered: boolean;
  reason?: string;
}

interface ElementLike {
  type?: unknown;
  props?: unknown;
  children?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRenderableElement(value: unknown): value is { type: string; props: Record<string, unknown>; children?: string[] } {
  if (!isRecord(value)) return false;
  return typeof value.type === "string" && isRecord(value.props);
}

function sanitizeElement(value: ElementLike): { type: string; props: Record<string, unknown>; children: string[] } | null {
  if (typeof value.type !== "string") return null;
  const props = isRecord(value.props) ? value.props : {};
  const children = Array.isArray(value.children) ? value.children.filter((child): child is string => typeof child === "string") : [];
  return { type: value.type, props, children };
}

export function createRecoveredJsonArtifactSpec(title: string, reason = "invalid_spec"): Spec {
  return {
    root: "main",
    elements: {
      main: {
        type: "Card",
        props: {
          title: title || "Recovered artifact",
          description: "The model attempted to create a canvas artifact, but the emitted JSON-render spec was not renderable. The workspace recovered with this starter canvas instead of silently failing.",
        },
        children: ["body"],
      },
      body: {
        type: "Text",
        props: {
          content: `Recovery reason: ${reason}. Ask the agent to refine this artifact and it can replace this starter spec with a complete JSON-render canvas.`,
        },
        children: [],
      },
    },
    state: {},
  } as Spec;
}

/**
 * Recovery-only normalization used by artifact extraction/promotion paths that
 * need a renderable fallback instead of a hard failure. Agent-facing tool calls
 * must validate against the stricter createJsonArtifact schema first and treat
 * `recovered: true` as rejection evidence, not as a successful artifact.
 */
export function normalizeJsonArtifactSpec(input: unknown, title: string): NormalizedJsonArtifactSpec {
  if (!isRecord(input)) {
    return { spec: createRecoveredJsonArtifactSpec(title, "spec_not_object"), recovered: true, reason: "spec_not_object" };
  }

  const requestedRoot = typeof input.root === "string" && input.root.trim() ? input.root.trim() : "main";
  const rawElements = isRecord(input.elements) ? input.elements : {};
  const elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }> = {};

  for (const [id, rawElement] of Object.entries(rawElements)) {
    const element = sanitizeElement(rawElement as ElementLike);
    if (element) elements[id] = element;
  }

  if (Object.keys(elements).length === 0) {
    return { spec: createRecoveredJsonArtifactSpec(title, "empty_elements"), recovered: true, reason: "empty_elements" };
  }

  if (!isRenderableElement(elements[requestedRoot])) {
    const firstElementId = Object.keys(elements)[0];
    if (firstElementId) {
      return {
        spec: {
          root: firstElementId,
          elements,
          state: isRecord(input.state) ? input.state : {},
        } as Spec,
        recovered: true,
        reason: "missing_root_element",
      };
    }
  }

  return {
    spec: {
      root: requestedRoot,
      elements,
      state: isRecord(input.state) ? input.state : {},
    } as Spec,
    recovered: false,
  };
}

export { default as JsonArtifactRenderer } from "./renderer/JsonArtifactRenderer.svelte";
export { default as JsonInlineRenderer } from "./renderer/JsonInlineRenderer.svelte";

export type { ComponentRegistry, Spec } from "@json-render/svelte";
export { createInteractiveSurfaceJsonRenderSpec } from "./intake.js";
export type { JsonRenderSpecLike } from "./intake.js";

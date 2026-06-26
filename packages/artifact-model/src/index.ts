export type { Artifact, ArtifactKind, CreateArtifactInput } from "./model/artifact.js";
export { createArtifact, replaceArtifactContent } from "./model/artifact.js";
export type {
  CreateJsonRenderArtifactInput,
  JsonRenderArtifact,
  UpsertJsonRenderArtifactInput,
  UpsertJsonRenderArtifactResult,
} from "./model/json-render-artifact.js";
export {
  createJsonRenderArtifact,
  createJsonRenderArtifactSignature,
  upsertJsonRenderArtifact,
} from "./model/json-render-artifact.js";
export type { CreateHtmlArtifactInput, HtmlArtifact, HtmlArtifactContent } from "./model/html-artifact.js";
export { createHtmlArtifact } from "./model/html-artifact.js";
export type {
  CreateDocumentArtifactInput,
  DocumentArtifact,
  DocumentArtifactContent,
  DocumentArtifactFormat,
} from "./model/document-artifact.js";
export { createDocumentArtifact } from "./model/document-artifact.js";
export type {
  ApplyArtifactJsonPatchesInput,
  ArtifactJsonPatch,
  TryApplyArtifactJsonPatchesResult,
} from "./patches/json-patch.js";
export {
  applyArtifactJsonPatch,
  applyArtifactJsonPatches,
  tryApplyArtifactJsonPatches,
} from "./patches/json-patch.js";
export type {
  FindReplacePatch,
  FindReplacePatchResult,
  FindReplaceRange,
  TextFindReplaceResult,
} from "./patches/find-replace-patch.js";
export {
  applyDocumentFindReplacePatch,
  applyFindReplaceToText,
} from "./patches/find-replace-patch.js";
export type {
  ArtifactVersionEntry,
  ArtifactVersionStore,
} from "./versions/version-store.js";
export {
  appendArtifactVersion,
  createArtifactVersionStore,
  getLatestArtifactVersion,
  toArtifactVersionEntry,
} from "./versions/version-store.js";

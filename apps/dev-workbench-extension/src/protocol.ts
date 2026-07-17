// @ts-nocheck
export const TRANSPORT_VERSION = "sonik.active-tab.v1";
export const VISUAL_VERSION = "sonik.visual-context.v1";

const operations = new Set(["get-capabilities", "capture", "pair-extension", "unpair-extension"]);
const maxPngBytes = 10 * 1024 * 1024;

export function isExactWorkbenchRequest(request, allowedOrigins, route) {
  return Boolean(request)
    && request.messageSource === "sonik-agent-ui"
    && request.type === "sonik:visual-context:request"
    && request.version === VISUAL_VERSION
    && operations.has(request.operation)
    && request.provider === "chrome-active-tab"
    && allowedOrigins.has(request.origin)
    && request.source?.id === "host"
    && request.source.route === route
    && Number.isInteger(request.sourceContextRevision)
    && Number.isInteger(request.routeRevision)
    && typeof request.requestId === "string"
    && request.requestId.length > 0
    && request.requestId.length <= 128;
}

export function createResult(request, fields = {}) {
  return {
    ...request,
    messageSource: "sonik-agent-host",
    type: "sonik:visual-context:result",
    status: "completed",
    ...fields,
  };
}

export function pngMetadata(dataUrl) {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) throw new TypeError("Active-tab capture did not return PNG data.");
  const bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length)), (character) => character.charCodeAt(0));
  if (bytes.length > maxPngBytes) throw new TypeError("Active-tab capture exceeds the 10 MiB limit.");
  if (bytes.length < 24 || bytes.slice(0, 8).join(",") !== "137,80,78,71,13,10,26,10") {
    throw new TypeError("Active-tab capture returned an invalid PNG.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { bytes, width: view.getUint32(16), height: view.getUint32(20), pngBase64: dataUrl.slice(prefix.length) };
}

// @ts-nocheck
export const TRANSPORT_VERSION = "sonik.active-tab.v1";
export const VISUAL_VERSION = "sonik.visual-context.v1";

const operations = new Set(["get-capabilities", "capture", "pair-extension", "unpair-extension"]);
const maxPngBytes = 10 * 1024 * 1024;
const maxPngBase64Length = Math.ceil(maxPngBytes / 3) * 4;
const redactionKinds = new Set(["Sensitive form controls", "Embedded frame pixels"]);

export function isSafeCapturePreparation(value) {
  const viewport = value?.viewport;
  return Array.isArray(value?.redactionsApplied)
    && value.redactionsApplied.every((item) => redactionKinds.has(item))
    && Number.isInteger(viewport?.width) && viewport.width > 0 && viewport.width <= 16_384
    && Number.isInteger(viewport?.height) && viewport.height > 0 && viewport.height <= 16_384
    && Number.isFinite(viewport?.deviceScaleFactor) && viewport.deviceScaleFactor > 0 && viewport.deviceScaleFactor <= 8;
}

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
    && Number.isInteger(request.sourceContextRevision) && request.sourceContextRevision >= 0
    && Number.isInteger(request.routeRevision) && request.routeRevision >= 0
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
  const pngBase64 = dataUrl.slice(prefix.length);
  if (pngBase64.length > maxPngBase64Length) throw new TypeError("Active-tab capture exceeds the 10 MiB limit.");
  const bytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
  if (bytes.length > maxPngBytes) throw new TypeError("Active-tab capture exceeds the 10 MiB limit.");
  if (bytes.length < 24 || bytes.slice(0, 8).join(",") !== "137,80,78,71,13,10,26,10") {
    throw new TypeError("Active-tab capture returned an invalid PNG.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0 || width > 16_384 || height > 16_384) throw new TypeError("Active-tab capture returned invalid PNG dimensions.");
  return { bytes, width, height, pngBase64 };
}

export function matchesCaptureViewport(png, viewport) {
  return png.width === Math.round(viewport.width * viewport.deviceScaleFactor)
    && png.height === Math.round(viewport.height * viewport.deviceScaleFactor);
}

import { z } from "zod";
import { semanticTargetIdSchema } from "./target-registry.js";

export const visualContextVersion = "sonik.visual-context.v1" as const;
export const maxVisualContextAriaLength = 32_000;
export const maxVisualContextImageBytes = 10 * 1024 * 1024;

const boundedIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const likelySecretPattern = /(?:\bbearer\s+[a-zA-Z0-9._-]{12,}|\b(?:bearer|api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\b\s*[:=]\s*\S+|\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}|\bsk_(?:live|test)_[a-zA-Z0-9]{12,})/i;
const selectorOnlyPattern = /^(?:[#.][a-zA-Z_-][\w-]*|\[[^\]]+\]|\/\/|\/html\b)/;
const boundedPublicTextSchema = z.string().trim().min(1).max(160)
  .refine((value) => !likelySecretPattern.test(value), "Public visual context must not contain credential-like values.")
  .refine((value) => !selectorOnlyPattern.test(value), "Public visual context must not expose selectors or DOM paths.");

export const visualContextOriginSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
}, "Origin must be an exact http(s) origin without a path, query, hash, or credentials.");

export const visualContextRouteSchema = z.string()
  .min(1)
  .max(2_048)
  .startsWith("/")
  .refine((value) => !value.includes("?") && !value.includes("#") && !value.startsWith("//"), "Route must be a sanitized path without query or hash data.");

export const visualContextOperationSchema = z.enum([
  "get-capabilities",
  "pick",
  "clear",
  "capture",
  "setup-browser",
  "pair-extension",
  "unpair-extension",
]);

export const visualContextProviderSchema = z.enum(["host", "playwright", "chrome-active-tab"]);
export const visualContextFidelitySchema = z.enum(["controlled-preview", "exact-active-tab"]);
export const visualContextCaptureBasisSchema = z.enum(["fresh-playwright-navigation", "native-active-tab-redacted"]);
export const visualContextSelectionResolutionSchema = z.enum(["not-requested", "stable-target", "unavailable-in-playwright"]);

export const visualContextSourceSchema = z.strictObject({
  id: z.enum(["preview", "host"]),
  label: boundedPublicTextSchema,
  surface: boundedIdSchema,
  route: visualContextRouteSchema,
});

export const visualContextBoundsSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  coordinateSpace: z.literal("viewport"),
});

export const visualContextSelectionSchema = z.strictObject({
  targetId: semanticTargetIdSchema,
  targetInstanceId: boundedIdSchema.optional(),
  label: boundedPublicTextSchema,
  role: boundedPublicTextSchema.optional(),
  accessibleName: boundedPublicTextSchema.optional(),
  bounds: visualContextBoundsSchema,
  selectedAt: z.string().datetime(),
});

export const visualContextViewportSchema = z.strictObject({
  width: z.number().int().positive().max(8_192),
  height: z.number().int().positive().max(8_192),
  deviceScaleFactor: z.number().positive().max(4),
});

export const visualContextScreenshotSchema = z.strictObject({
  mime: z.literal("image/png"),
  width: z.number().int().positive().max(8_192),
  height: z.number().int().positive().max(8_192),
  bytes: z.number().int().positive().max(maxVisualContextImageBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  provider: visualContextProviderSchema.exclude(["host"]),
  fidelity: visualContextFidelitySchema,
  captureBasis: visualContextCaptureBasisSchema,
  viewport: visualContextViewportSchema,
  redactionsApplied: z.array(boundedPublicTextSchema).max(64),
  capturedAt: z.string().datetime(),
  temporaryPath: z.string().regex(/^\/vercel\/sandbox\/workspace\/\.sonik\/(?:tmp\/visual-context|screenshots\/requests)\/[a-zA-Z0-9._-]+\.png$/).optional(),
  pngBase64: z.string().max(Math.ceil(maxVisualContextImageBytes / 3) * 4).optional(),
}).superRefine((screenshot, ctx) => {
  const expectedFidelity = screenshot.provider === "playwright" ? "controlled-preview" : "exact-active-tab";
  const expectedBasis = screenshot.provider === "playwright" ? "fresh-playwright-navigation" : "native-active-tab-redacted";
  if (screenshot.fidelity !== expectedFidelity) ctx.addIssue({ code: "custom", path: ["fidelity"], message: "Fidelity must match the capture provider." });
  if (screenshot.captureBasis !== expectedBasis) ctx.addIssue({ code: "custom", path: ["captureBasis"], message: "Capture basis must match the capture provider." });
  if (screenshot.provider === "playwright" && !screenshot.temporaryPath) ctx.addIssue({ code: "custom", path: ["temporaryPath"], message: "Playwright results require a request-scoped temporary path." });
  if (screenshot.provider === "chrome-active-tab" && !screenshot.pngBase64) ctx.addIssue({ code: "custom", path: ["pngBase64"], message: "Active-tab results require bounded PNG data." });
});

export const visualContextCapabilitySchema = z.strictObject({
  operation: visualContextOperationSchema,
  status: z.enum(["available", "unavailable", "pending", "failed"]),
  provider: visualContextProviderSchema.optional(),
  disabledReason: boundedPublicTextSchema.optional(),
}).superRefine((capability, ctx) => {
  if (capability.status !== "available" && !capability.disabledReason) {
    ctx.addIssue({ code: "custom", path: ["disabledReason"], message: "Unavailable capabilities require a bounded reason." });
  }
});

const visualContextCorrelationSchema = z.strictObject({
  requestId: boundedIdSchema,
  operation: visualContextOperationSchema,
  sourceContextRevision: z.number().int().nonnegative(),
  routeRevision: z.number().int().nonnegative(),
  source: visualContextSourceSchema,
  provider: visualContextProviderSchema.optional(),
});

export const visualContextRequestSchema = visualContextCorrelationSchema.extend({
  messageSource: z.literal("sonik-agent-ui"),
  type: z.literal("sonik:visual-context:request"),
  version: z.literal(visualContextVersion),
  origin: visualContextOriginSchema,
  targetId: semanticTargetIdSchema.optional(),
  targetInstanceId: boundedIdSchema.optional(),
  viewport: visualContextViewportSchema.optional(),
}).strict().superRefine((request, ctx) => validateOperationProvider(request.operation, request.provider, ctx));

export const visualContextResultStatusSchema = z.enum(["completed", "cancelled", "unavailable", "invalid-request", "failed"]);

export const visualContextResultSchema = visualContextCorrelationSchema.extend({
  messageSource: z.literal("sonik-agent-host"),
  type: z.literal("sonik:visual-context:result"),
  version: z.literal(visualContextVersion),
  origin: visualContextOriginSchema,
  status: visualContextResultStatusSchema,
  capabilities: z.array(visualContextCapabilitySchema).max(16).optional(),
  selection: visualContextSelectionSchema.nullable().optional(),
  ariaSnapshot: z.string().max(maxVisualContextAriaLength).refine((value) => !likelySecretPattern.test(value), "ARIA snapshot must be sanitized before crossing the public boundary.").nullable().optional(),
  selectionResolution: visualContextSelectionResolutionSchema.optional(),
  screenshot: visualContextScreenshotSchema.nullable().optional(),
  disabledReason: boundedPublicTextSchema.optional(),
}).strict().superRefine((result, ctx) => {
  validateOperationProvider(result.operation, result.provider, ctx);
  if (result.status !== "completed" && !result.disabledReason) {
    ctx.addIssue({ code: "custom", path: ["disabledReason"], message: "Non-completed results require a bounded reason." });
  }
  if (result.status === "completed" && result.operation === "get-capabilities" && !result.capabilities) {
    ctx.addIssue({ code: "custom", path: ["capabilities"], message: "Capability results require capabilities." });
  }
  if (result.status === "completed" && result.operation === "pick" && !result.selection) {
    ctx.addIssue({ code: "custom", path: ["selection"], message: "Successful pick results require a selection." });
  }
  if (result.status === "completed" && result.operation === "capture" && !result.screenshot) {
    ctx.addIssue({ code: "custom", path: ["screenshot"], message: "Successful capture results require screenshot metadata." });
  }
  if (result.status === "completed" && result.operation === "capture" && !result.selectionResolution) {
    ctx.addIssue({ code: "custom", path: ["selectionResolution"], message: "Successful capture results require selection resolution." });
  }
  if (result.screenshot && result.provider !== result.screenshot.provider) {
    ctx.addIssue({ code: "custom", path: ["screenshot", "provider"], message: "Screenshot provider must match the result provider." });
  }
});

export const visualContextSnapshotScreenshotSchema = z.strictObject({
  path: z.literal("/vercel/sandbox/workspace/.sonik/screenshots/latest.png"),
  mime: z.literal("image/png"),
  width: z.number().int().positive().max(8_192),
  height: z.number().int().positive().max(8_192),
  bytes: z.number().int().positive().max(maxVisualContextImageBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  provider: visualContextProviderSchema.exclude(["host"]),
  fidelity: visualContextFidelitySchema,
  captureBasis: visualContextCaptureBasisSchema,
  viewport: visualContextViewportSchema,
  redactionsApplied: z.array(boundedPublicTextSchema).max(64),
  capturedAt: z.string().datetime(),
}).superRefine((screenshot, ctx) => {
  const expectedFidelity = screenshot.provider === "playwright" ? "controlled-preview" : "exact-active-tab";
  const expectedBasis = screenshot.provider === "playwright" ? "fresh-playwright-navigation" : "native-active-tab-redacted";
  if (screenshot.fidelity !== expectedFidelity) ctx.addIssue({ code: "custom", path: ["fidelity"], message: "Fidelity must match the capture provider." });
  if (screenshot.captureBasis !== expectedBasis) ctx.addIssue({ code: "custom", path: ["captureBasis"], message: "Capture basis must match the capture provider." });
});

export const visualContextSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(visualContextVersion),
  status: z.enum(["current", "invalidated"]),
  generation: boundedIdSchema,
  requestId: boundedIdSchema.nullable(),
  sourceContextRevision: z.number().int().nonnegative(),
  routeRevision: z.number().int().nonnegative(),
  source: visualContextSourceSchema,
  selection: visualContextSelectionSchema.nullable(),
  ariaSnapshot: z.string().max(maxVisualContextAriaLength).refine((value) => !likelySecretPattern.test(value), "ARIA snapshot must be sanitized before persistence.").nullable(),
  selectionResolution: visualContextSelectionResolutionSchema,
  screenshot: visualContextSnapshotScreenshotSchema.nullable(),
  invalidatedAt: z.string().datetime().nullable(),
  staleReason: z.enum(["source-changed", "route-changed", "navigation", "cancelled", "provider-lost"]).nullable(),
}).superRefine((snapshot, ctx) => {
  if (snapshot.status === "current" && (snapshot.invalidatedAt || snapshot.staleReason)) {
    ctx.addIssue({ code: "custom", path: ["status"], message: "Current snapshots cannot carry invalidation state." });
  }
  if (snapshot.status === "invalidated") {
    if (!snapshot.invalidatedAt || !snapshot.staleReason) {
      ctx.addIssue({ code: "custom", path: ["invalidatedAt"], message: "Invalidated snapshots require time and reason." });
    }
    if (snapshot.selection || snapshot.ariaSnapshot || snapshot.screenshot) {
      ctx.addIssue({ code: "custom", path: ["selection"], message: "Invalidated snapshots must clear visual artifacts." });
    }
  }
});

export type VisualContextOperation = z.infer<typeof visualContextOperationSchema>;
export type VisualContextProvider = z.infer<typeof visualContextProviderSchema>;
export type VisualContextSource = z.infer<typeof visualContextSourceSchema>;
export type VisualContextSelection = z.infer<typeof visualContextSelectionSchema>;
export type VisualContextCapability = z.infer<typeof visualContextCapabilitySchema>;
export type VisualContextRequest = z.infer<typeof visualContextRequestSchema>;
export type VisualContextResult = z.infer<typeof visualContextResultSchema>;
export type VisualContextSnapshot = z.infer<typeof visualContextSnapshotSchema>;

export function assertVisualContextResultMatchesRequest(request: VisualContextRequest, result: VisualContextResult): void {
  const fields = ["requestId", "operation", "sourceContextRevision", "routeRevision"] as const;
  for (const field of fields) {
    if (request[field] !== result[field]) throw new Error(`Visual context result ${field} does not match the pending request.`);
  }
  if (request.origin !== result.origin || request.source.id !== result.source.id || request.source.route !== result.source.route) {
    throw new Error("Visual context result origin/source does not match the pending request.");
  }
  if (request.provider && request.provider !== result.provider) {
    throw new Error("Visual context result provider does not match the pending request.");
  }
}

function validateOperationProvider(
  operation: VisualContextOperation,
  provider: VisualContextProvider | undefined,
  ctx: z.RefinementCtx,
): void {
  const requiredProvider = operation === "pick" || operation === "clear"
    ? "host"
    : operation === "capture"
      ? null
      : operation === "setup-browser"
        ? "playwright"
        : operation === "pair-extension" || operation === "unpair-extension"
          ? "chrome-active-tab"
          : undefined;
  if (requiredProvider === undefined) return;
  if (requiredProvider === null) {
    if (provider !== "playwright" && provider !== "chrome-active-tab") {
      ctx.addIssue({ code: "custom", path: ["provider"], message: "Capture requires a screenshot provider." });
    }
    return;
  }
  if (provider !== requiredProvider) {
    ctx.addIssue({ code: "custom", path: ["provider"], message: `${operation} requires provider ${requiredProvider}.` });
  }
}

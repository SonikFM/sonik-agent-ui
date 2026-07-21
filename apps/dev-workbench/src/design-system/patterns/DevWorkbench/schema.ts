import { z } from "zod";

export const workbenchDetailSchema = z.enum(["problems", "changes", "console", "network"]);
export type WorkbenchDetail = z.infer<typeof workbenchDetailSchema>;
export const workbenchVisualSourceIdSchema = z.enum(["preview", "host"]);
export type WorkbenchVisualSourceId = z.infer<typeof workbenchVisualSourceIdSchema>;

export const workbenchActionStateSchema = z.strictObject({
  enabled: z.boolean(),
  disabledReason: z.string().min(1).nullable(),
});

export const devWorkbenchSchema = z.strictObject({
  title: z.string().min(1),
  repository: z.strictObject({
    name: z.string().min(1),
    branch: z.string().min(1),
    revision: z.string().min(1),
    dirty: z.boolean(),
  }),
  workspace: z.strictObject({
    status: z.enum(["idle", "starting", "ready", "stopping", "stopped", "error"]),
    label: z.string().min(1),
    message: z.string().min(1),
  }),
  preview: z.strictObject({
    status: z.enum(["connecting", "ready", "stale", "unavailable", "error"]),
    url: z.string().url().nullable(),
    path: z.string().min(1),
    viewportLabel: z.string().min(1),
    disabledReason: z.string().min(1).nullable(),
  }),
  terminal: z.strictObject({
    status: z.enum(["connecting", "ready", "unavailable", "error"]),
    sessionName: z.string().min(1),
    cwd: z.string().min(1),
    transport: z.string().min(1),
    disabledReason: z.string().min(1).nullable(),
  }),
  visualContext: z.strictObject({
    sources: z.array(z.strictObject({
      id: workbenchVisualSourceIdSchema,
      label: z.string().min(1).max(160),
      route: z.string().min(1),
    })).max(2),
    selectedSourceId: workbenchVisualSourceIdSchema.nullable(),
    sourceContextRevision: z.number().int().nonnegative(),
    routeRevision: z.number().int().nonnegative(),
    status: z.enum(["idle", "picking", "capturing", "invalidated", "error"]),
    statusMessage: z.string().min(1).nullable(),
    staleReason: z.enum(["source-changed", "route-changed", "navigation", "cancelled", "provider-lost"]).nullable(),
  }),
  activeDetail: workbenchDetailSchema,
  problems: z.array(
    z.strictObject({
      id: z.string().min(1),
      severity: z.enum(["error", "warning", "info"]),
      message: z.string().min(1),
      file: z.string().min(1).nullable(),
      line: z.number().int().positive().nullable(),
    }),
  ),
  changedFiles: z.array(
    z.strictObject({
      path: z.string().min(1),
      status: z.enum(["added", "modified", "deleted", "renamed"]),
    }),
  ),
  consoleEntries: z.array(z.string()),
  failedRequests: z.array(z.string()),
  actions: z.strictObject({
    startWorkspace: workbenchActionStateSchema,
    reconnectTerminal: workbenchActionStateSchema,
    restartPreview: workbenchActionStateSchema,
    captureSnapshot: workbenchActionStateSchema,
    pickVisualTarget: workbenchActionStateSchema,
    captureVisualContext: workbenchActionStateSchema,
    setupVisualBrowser: workbenchActionStateSchema,
    pairVisualExtension: workbenchActionStateSchema,
    openPreview: workbenchActionStateSchema,
    stopWorkspace: workbenchActionStateSchema,
  }),
});

export type DevWorkbenchViewProps = z.infer<typeof devWorkbenchSchema>;

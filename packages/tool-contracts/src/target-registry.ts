import { z } from "zod";

export const targetRegistryVersion = "sonik-agent-ui.target-registry.v0" as const;
export const agentActionChannelVersion = "sonik.agent_ui.host_action.v1" as const;

export const semanticTargetIdSchema = z.string()
  .min(1)
  .regex(/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/i, "Target ids must be stable semantic ids, not raw selectors or DOM paths.");

export const hostUiTargetCapabilitySchema = z.enum([
  "select",
  "highlight",
  "focus",
  "scroll",
  "open",
  "describe",
  "edit",
  "approve",
  "run",
]);

export const hostActionPolicyModeSchema = z.enum(["block", "ask", "allow", "require"]);

export const hostUiTargetEntityRefSchema = z.strictObject({
  kind: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1).optional(),
});

export const hostUiTargetBoundsSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  coordinateSpace: z.enum(["viewport", "surface", "canvas", "artifact"]).default("surface"),
});

export const hostUiTargetLocatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("data-sonik-target"),
    value: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("data-sonik-target-instance"),
    value: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("bounds"),
    bounds: hostUiTargetBoundsSchema,
  }),
  z.strictObject({
    kind: z.literal("host-private"),
    ref: z.string().min(1),
  }),
]);

export const hostUiTargetPolicySchema = z.strictObject({
  actionMode: hostActionPolicyModeSchema,
  reason: z.string().min(1).optional(),
});

export const hostUiTargetSchema = z.strictObject({
  targetId: semanticTargetIdSchema,
  targetInstanceId: z.string().min(1).optional(),
  label: z.string().min(1),
  description: z.string().min(1),
  surface: z.string().min(1),
  entityRef: hostUiTargetEntityRefSchema.optional(),
  capabilities: z.array(hostUiTargetCapabilitySchema).min(1),
  visible: z.boolean().default(true),
  enabled: z.boolean().default(true),
  disabledReason: z.string().min(1).optional(),
  locator: hostUiTargetLocatorSchema.optional(),
  bounds: hostUiTargetBoundsSchema.optional(),
  policy: hostUiTargetPolicySchema.default({ actionMode: "allow" }),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((target, ctx) => {
  if (target.enabled === false && !target.disabledReason) {
    ctx.addIssue({ code: "custom", path: ["disabledReason"], message: "Disabled targets require a disabledReason." });
  }
  if (target.locator?.kind === "data-sonik-target" && target.locator.value !== target.targetId) {
    ctx.addIssue({ code: "custom", path: ["locator", "value"], message: "data-sonik-target locator value must match targetId." });
  }
  if (target.locator?.kind === "data-sonik-target-instance" && target.targetInstanceId && target.locator.value !== target.targetInstanceId) {
    ctx.addIssue({ code: "custom", path: ["locator", "value"], message: "data-sonik-target-instance locator value must match targetInstanceId when present." });
  }
  if (target.locator?.kind === "bounds" && target.bounds) {
    const locatorBounds = target.locator.bounds;
    if (locatorBounds.x !== target.bounds.x || locatorBounds.y !== target.bounds.y || locatorBounds.width !== target.bounds.width || locatorBounds.height !== target.bounds.height) {
      ctx.addIssue({ code: "custom", path: ["bounds"], message: "Top-level bounds and locator bounds must match when both are provided." });
    }
  }
  if (target.policy.actionMode === "allow" && (target.capabilities.includes("approve") || target.capabilities.includes("run"))) {
    ctx.addIssue({ code: "custom", path: ["policy", "actionMode"], message: "approve/run targets must not default to allow; use ask, require, or block." });
  }
});

export const hostUiTargetRegistrySchema = z.strictObject({
  version: z.literal(targetRegistryVersion),
  generatedAt: z.string().min(1),
  provider: z.string().min(1),
  route: z.string().optional(),
  surface: z.string().optional(),
  targets: z.array(hostUiTargetSchema),
});

export const hostActionKeySchema = z.enum([
  "canvas.open",
  "canvas.close",
  "tour.highlight",
  "tour.annotate",
  "tour.focusTarget",
  "tour.clear",
  "approval.requestPreview",
  "approval.confirmTrustedAction",
  "artifact.submitAnswer",
]);

export const hostActionRequestSchema = z.strictObject({
  source: z.literal("sonik-agent-ui"),
  type: z.literal("sonik:agent-ui:action-request"),
  version: z.literal(agentActionChannelVersion),
  requestId: z.string().min(1),
  actionKey: hostActionKeySchema,
  targetId: semanticTargetIdSchema.optional(),
  targetInstanceId: z.string().min(1).optional(),
  entityRef: hostUiTargetEntityRefSchema.optional(),
  input: z.unknown().optional(),
  intentLabel: z.string().min(1).optional(),
  requiresReceipt: z.boolean().default(true),
});

export const hostActionReceiptSchema = z.strictObject({
  traceId: z.string().min(1).optional(),
  commandId: z.string().min(1).optional(),
  actionKey: hostActionKeySchema.optional(),
  targetId: semanticTargetIdSchema.optional(),
  targetInstanceId: z.string().min(1).optional(),
  entityRef: hostUiTargetEntityRefSchema.optional(),
  effect: z.enum(["read", "write", "destructive", "environment", "ui"]).default("ui"),
  telemetry: z.record(z.string(), z.unknown()).default({}),
});

export const hostActionResultStatusSchema = z.enum([
  "executed",
  "approval_required",
  "blocked",
  "requires_prerequisite",
  "invalid_request",
  "unavailable",
]);

export const hostActionResultSchema = z.strictObject({
  source: z.literal("sonik-agent-host"),
  type: z.literal("sonik:agent-ui:action-result"),
  version: z.literal(agentActionChannelVersion),
  requestId: z.string().min(1),
  actionKey: hostActionKeySchema,
  ok: z.boolean(),
  status: hostActionResultStatusSchema,
  policyMode: hostActionPolicyModeSchema,
  message: z.string().min(1).optional(),
  disabledReason: z.string().min(1).optional(),
  receipt: hostActionReceiptSchema.optional(),
}).superRefine((result, ctx) => {
  if (result.ok && result.status !== "executed") {
    ctx.addIssue({ code: "custom", path: ["status"], message: "ok host-action results must use status executed." });
  }
  if (!result.ok && result.status === "executed") {
    ctx.addIssue({ code: "custom", path: ["ok"], message: "executed host-action results must set ok true." });
  }
  if (!result.ok && !result.message && !result.disabledReason) {
    ctx.addIssue({ code: "custom", path: ["message"], message: "Non-ok host-action results require message or disabledReason." });
  }
});

export type HostUiTargetCapability = z.infer<typeof hostUiTargetCapabilitySchema>;
export type HostActionPolicyMode = z.infer<typeof hostActionPolicyModeSchema>;
export type HostUiTargetEntityRef = z.infer<typeof hostUiTargetEntityRefSchema>;
export type HostUiTargetBounds = z.infer<typeof hostUiTargetBoundsSchema>;
export type HostUiTargetLocator = z.infer<typeof hostUiTargetLocatorSchema>;
export type HostUiTarget = z.infer<typeof hostUiTargetSchema>;
export type HostUiTargetRegistry = z.infer<typeof hostUiTargetRegistrySchema>;
export type HostActionKey = z.infer<typeof hostActionKeySchema>;
export type HostActionRequest = z.infer<typeof hostActionRequestSchema>;
export type HostActionReceipt = z.infer<typeof hostActionReceiptSchema>;
export type HostActionResult = z.infer<typeof hostActionResultSchema>;

export type HostUiTargetLookup = {
  targetId: string;
  targetInstanceId?: string;
  entityRef?: HostUiTargetEntityRef;
  capability?: HostUiTargetCapability;
};

export type HostActionEvaluationInput = {
  request: HostActionRequest;
  registry?: HostUiTargetRegistry;
  allowedActions?: readonly HostActionKey[];
  trustedApprovalRefs?: readonly string[];
};

export const DEFAULT_HOST_ACTION_ALLOWLIST: readonly HostActionKey[] = [
  "canvas.open",
  "canvas.close",
  "tour.highlight",
  "tour.annotate",
  "tour.focusTarget",
  "tour.clear",
  "approval.requestPreview",
  "artifact.submitAnswer",
];

const approvalBypassKeys = new Set(["approved", "approvalGranted", "trusted", "trustedApproval", "approvedCommandIds"]);
const trustedApprovalInputSchema = z.strictObject({ trustedApprovalRef: z.string().min(1) });
const actionCapabilityMap: Record<HostActionKey, HostUiTargetCapability | null> = {
  "canvas.open": null,
  "canvas.close": null,
  "tour.highlight": "highlight",
  "tour.annotate": "describe",
  "tour.focusTarget": "focus",
  "tour.clear": null,
  "approval.requestPreview": null,
  "approval.confirmTrustedAction": null,
  "artifact.submitAnswer": "edit",
};

export function createHostUiTargetRegistry(input: Omit<HostUiTargetRegistry, "version"> & { version?: typeof targetRegistryVersion }): HostUiTargetRegistry {
  const parsed = hostUiTargetRegistrySchema.parse({ ...input, version: targetRegistryVersion });
  const seen = new Set<string>();
  for (const target of parsed.targets) {
    const key = createHostUiTargetKey(target);
    if (seen.has(key)) throw new Error(`Duplicate host UI target key: ${key}`);
    seen.add(key);
  }
  return parsed;
}

export function normalizeHostUiTarget(input: unknown): HostUiTarget {
  const parsed = hostUiTargetSchema.parse(input);
  return {
    ...parsed,
    capabilities: [...new Set(parsed.capabilities)],
    metadata: { ...parsed.metadata },
  };
}

export function createHostUiTargetKey(target: Pick<HostUiTarget, "targetId" | "targetInstanceId" | "entityRef">): string {
  if (target.targetInstanceId) return `${target.targetId}#${target.targetInstanceId}`;
  if (target.entityRef) return `${target.targetId}@${target.entityRef.kind}:${target.entityRef.id}`;
  return target.targetId;
}

export function findHostUiTarget(registry: HostUiTargetRegistry, lookup: HostUiTargetLookup): HostUiTarget | undefined {
  return registry.targets.find((target) => {
    if (target.targetId !== lookup.targetId) return false;
    if (lookup.targetInstanceId && target.targetInstanceId !== lookup.targetInstanceId) return false;
    if (lookup.entityRef) {
      if (!target.entityRef) return false;
      if (target.entityRef.kind !== lookup.entityRef.kind || target.entityRef.id !== lookup.entityRef.id) return false;
    }
    if (lookup.capability && !target.capabilities.includes(lookup.capability)) return false;
    return true;
  });
}

export function createHostActionRequest(input: Omit<HostActionRequest, "source" | "type" | "version"> & Partial<Pick<HostActionRequest, "source" | "type" | "version">>): HostActionRequest {
  return hostActionRequestSchema.parse({
    source: "sonik-agent-ui",
    type: "sonik:agent-ui:action-request",
    version: agentActionChannelVersion,
    ...input,
  });
}

export function createHostActionResult(input: Omit<HostActionResult, "source" | "type" | "version"> & Partial<Pick<HostActionResult, "source" | "type" | "version">>): HostActionResult {
  return hostActionResultSchema.parse({
    source: "sonik-agent-host",
    type: "sonik:agent-ui:action-result",
    version: agentActionChannelVersion,
    ...input,
  });
}

export function evaluateHostActionRequest(input: HostActionEvaluationInput): HostActionResult {
  const request = hostActionRequestSchema.parse(input.request);
  const allowedActions = new Set(input.allowedActions ?? DEFAULT_HOST_ACTION_ALLOWLIST);

  if (!allowedActions.has(request.actionKey)) {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "blocked",
      policyMode: "block",
      disabledReason: "host_action_not_allowlisted",
    });
  }

  if (containsApprovalBypass(input.request.input)) {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "invalid_request",
      policyMode: "block",
      disabledReason: "model_supplied_approval_is_not_trusted",
    });
  }

  const requiredCapability = request.actionKey === "approval.requestPreview" && request.targetId
    ? "approve"
    : actionCapabilityMap[request.actionKey];
  if (requiredCapability && !request.targetId) {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "invalid_request",
      policyMode: "require",
      disabledReason: "target_required",
    });
  }
  const target = request.targetId && input.registry
    ? findHostUiTarget(input.registry, { targetId: request.targetId, targetInstanceId: request.targetInstanceId, entityRef: request.entityRef, capability: requiredCapability ?? undefined })
    : undefined;

  if (request.targetId && !input.registry) {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "unavailable",
      policyMode: "require",
      disabledReason: "target_registry_unavailable",
    });
  }

  if (request.targetId && !target) {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "requires_prerequisite",
      policyMode: "require",
      disabledReason: "target_not_found_or_capability_unavailable",
    });
  }

  if (target && !target.visible) {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "requires_prerequisite",
      policyMode: "require",
      disabledReason: "target_not_visible",
    });
  }

  if (target && !target.enabled) {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "blocked",
      policyMode: "block",
      disabledReason: target.disabledReason ?? "target_disabled",
    });
  }

  if (request.actionKey === "approval.requestPreview") {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "approval_required",
      policyMode: "ask",
      message: target?.policy.reason ?? "Host approval preview is required before this action can run.",
      receipt: target ? createHostActionReceipt(request, target) : createHostActionReceipt(request),
    });
  }

  const policyMode = target?.policy.actionMode ?? defaultPolicyForAction(request.actionKey);
  if (policyMode === "block") {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "blocked",
      policyMode,
      disabledReason: target?.policy.reason ?? "host_action_blocked_by_policy",
    });
  }
  if (policyMode === "require") {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "requires_prerequisite",
      policyMode,
      disabledReason: target?.policy.reason ?? "host_action_requires_prerequisite",
    });
  }
  if (policyMode === "ask") {
    return createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "approval_required",
      policyMode,
      message: target?.policy.reason ?? "Host approval is required before this action can run.",
      receipt: target ? createHostActionReceipt(request, target) : undefined,
    });
  }

  if (request.actionKey === "approval.confirmTrustedAction") {
    const approvalInput = trustedApprovalInputSchema.safeParse(request.input ?? {});
    if (!approvalInput.success) {
      return createHostActionResult({
        requestId: request.requestId,
        actionKey: request.actionKey,
        ok: false,
        status: "invalid_request",
        policyMode: "block",
        disabledReason: "trusted_approval_ref_required",
      });
    }
    const trustedRefs = new Set(input.trustedApprovalRefs ?? []);
    if (!trustedRefs.has(approvalInput.data.trustedApprovalRef)) {
      return createHostActionResult({
        requestId: request.requestId,
        actionKey: request.actionKey,
        ok: false,
        status: "approval_required",
        policyMode: "ask",
        disabledReason: "trusted_approval_ref_required",
      });
    }
  }

  return createHostActionResult({
    requestId: request.requestId,
    actionKey: request.actionKey,
    ok: true,
    status: "executed",
    policyMode: "allow",
    message: "Host action executed by trusted host controller.",
    receipt: createHostActionReceipt(request, target),
  });
}

export function createHostActionReceipt(request: HostActionRequest, target?: HostUiTarget): HostActionReceipt {
  return hostActionReceiptSchema.parse({
    actionKey: request.actionKey,
    targetId: request.targetId ?? target?.targetId,
    targetInstanceId: request.targetInstanceId ?? target?.targetInstanceId,
    entityRef: request.entityRef ?? target?.entityRef,
    effect: request.actionKey.startsWith("approval.") ? "write" : "ui",
  });
}

export function getHostUiTargetDomAttributes(target: HostUiTarget): Record<string, string> {
  const attributes: Record<string, string> = { "data-sonik-target": target.targetId };
  if (target.targetInstanceId) attributes["data-sonik-target-instance"] = target.targetInstanceId;
  if (target.entityRef) {
    attributes["data-sonik-entity-kind"] = target.entityRef.kind;
    attributes["data-sonik-entity-id"] = target.entityRef.id;
  }
  return attributes;
}

export function resolveHostUiTargetBounds(target: HostUiTarget): HostUiTargetBounds | undefined {
  if (target.bounds) return target.bounds;
  if (target.locator?.kind === "bounds") return target.locator.bounds;
  return undefined;
}

export function createDefaultHostUiTargets(input: {
  activeArtifactId?: string;
  activeBookingContext?: { id: string; label: string };
} = {}): HostUiTarget[] {
  const targets: HostUiTarget[] = [
    normalizeHostUiTarget({
      targetId: "agent.chat.input",
      label: "Chat input",
      description: "Composer input where the user can ask the agent a follow-up.",
      surface: "agent-chat",
      capabilities: ["focus", "describe"],
      locator: { kind: "data-sonik-target", value: "agent.chat.input" },
    }),
    normalizeHostUiTarget({
      targetId: "agent.canvas.active-artifact",
      label: "Active artifact canvas",
      description: "Canvas region showing the active JSON-render artifact or document.",
      surface: "agent-canvas",
      capabilities: ["highlight", "scroll", "open", "describe"],
      entityRef: input.activeArtifactId ? { kind: "artifact", id: input.activeArtifactId } : undefined,
      locator: { kind: "data-sonik-target", value: "agent.canvas.active-artifact" },
    }),
    normalizeHostUiTarget({
      targetId: "artifact.question-card",
      label: "Artifact question card",
      description: "Interactive question card collecting structured user input for a JSON-render artifact.",
      surface: "agent-canvas",
      capabilities: ["highlight", "focus", "edit", "describe"],
      locator: { kind: "data-sonik-target", value: "artifact.question-card" },
    }),
    normalizeHostUiTarget({
      targetId: "artifact.approval-card",
      label: "Artifact approval card",
      description: "Approval preview card where the host can request trusted approval for a command-backed artifact action.",
      surface: "agent-canvas",
      capabilities: ["highlight", "focus", "approve", "describe"],
      policy: { actionMode: "ask", reason: "Approval cards require trusted host confirmation." },
      locator: { kind: "data-sonik-target", value: "artifact.approval-card" },
    }),
  ];

  if (input.activeBookingContext) {
    const entityRef = { kind: "booking_context", id: input.activeBookingContext.id, label: input.activeBookingContext.label };
    targets.push(
      normalizeHostUiTarget({
        targetId: "booking.ui.contextHeader",
        label: "Booking context header",
        description: "Header for the currently selected booking context.",
        surface: "booking-context",
        entityRef,
        capabilities: ["highlight", "scroll", "describe", "open"],
        locator: { kind: "data-sonik-target", value: "booking.ui.contextHeader" },
      }),
      normalizeHostUiTarget({
        targetId: "booking.ui.schedulePanel",
        label: "Booking schedule",
        description: "Schedule rules and operating hours for the selected booking context.",
        surface: "booking-context",
        entityRef,
        capabilities: ["highlight", "scroll", "focus", "edit", "describe"],
        locator: { kind: "data-sonik-target", value: "booking.ui.schedulePanel" },
      }),
      normalizeHostUiTarget({
        targetId: "booking.ui.inventoryPanel",
        label: "Booking inventory",
        description: "Resources, tables, slots, or inventory configured for the selected booking context.",
        surface: "booking-context",
        entityRef,
        capabilities: ["highlight", "scroll", "focus", "edit", "describe"],
        locator: { kind: "data-sonik-target", value: "booking.ui.inventoryPanel" },
      }),
      normalizeHostUiTarget({
        targetId: "booking.ui.commandApprovalPanel",
        label: "Booking command approval preview",
        description: "Command preview and approval region for booking context or reservation mutations.",
        surface: "booking-context",
        entityRef,
        capabilities: ["highlight", "scroll", "approve", "describe"],
        policy: { actionMode: "ask", reason: "Booking mutations require trusted host approval." },
        locator: { kind: "data-sonik-target", value: "booking.ui.commandApprovalPanel" },
      }),
    );
  }

  return targets;
}

export function createDefaultHostUiTargetRegistry(input: {
  provider: string;
  route?: string;
  surface?: string;
  generatedAt?: string;
  activeArtifactId?: string;
  activeBookingContext?: { id: string; label: string };
}): HostUiTargetRegistry {
  return createHostUiTargetRegistry({
    provider: input.provider,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    route: input.route,
    surface: input.surface,
    targets: createDefaultHostUiTargets(input),
  });
}

function defaultPolicyForAction(actionKey: HostActionKey): HostActionPolicyMode {
  if (actionKey === "approval.requestPreview") return "ask";
  return "allow";
}

function containsApprovalBypass(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsApprovalBypass(item, depth + 1));
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (approvalBypassKeys.has(key)) return true;
    if (containsApprovalBypass(nested, depth + 1)) return true;
  }
  return false;
}

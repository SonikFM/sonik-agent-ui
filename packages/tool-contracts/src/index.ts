import { z } from "zod";

export const toolSourceSchema = z.enum(["orpc", "openapi", "mcp", "sandbox", "local-ui"]);
export const toolEffectSchema = z.enum(["read", "write", "destructive", "environment", "unknown"]);
export const toolApprovalSchema = z.enum(["none", "required", "denied"]);
export const toolUiTargetSchema = z.enum(["none", "chat", "inline-json", "artifact", "canvas", "document", "terminal"]);

export type ToolSource = z.infer<typeof toolSourceSchema>;
export type ToolEffect = z.infer<typeof toolEffectSchema>;
export type ToolApproval = z.infer<typeof toolApprovalSchema>;
export type ToolUiTarget = z.infer<typeof toolUiTargetSchema>;

export const toolSchemaRefSchema = z.object({
  kind: z.enum(["zod", "json-schema", "openapi", "unknown"]),
  ref: z.string().optional(),
  schema: z.unknown().optional(),
});

export const toolContractEntrySchema = z.object({
  id: z.string().min(1),
  source: toolSourceSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  effect: toolEffectSchema,
  approval: toolApprovalSchema.default("none"),
  uiTargets: z.array(toolUiTargetSchema).default(["chat"]),
  capabilities: z.array(z.string()).default([]),
  input: toolSchemaRefSchema.default({ kind: "unknown" }),
  output: toolSchemaRefSchema.default({ kind: "unknown" }),
  auth: z.object({
    required: z.boolean().default(false),
    scopes: z.array(z.string()).default([]),
    orgScoped: z.boolean().default(false),
  }).default({ required: false, scopes: [], orgScoped: false }),
  transport: z.object({
    procedure: z.string().optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    runtimeStatus: z.enum(["mounted", "shadow", "unknown"]).default("unknown"),
  }).default({ runtimeStatus: "unknown" }),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const toolManifestSchema = z.object({
  version: z.literal("sonik-agent-ui.tool-manifest.v1"),
  generatedAt: z.string(),
  provider: z.string().min(1),
  tools: z.array(toolContractEntrySchema),
});

export type ToolSchemaRef = z.infer<typeof toolSchemaRefSchema>;
export type ToolContractEntry = z.infer<typeof toolContractEntrySchema>;
export type ToolManifest = z.infer<typeof toolManifestSchema>;

export type ToolAvailabilityContext = {
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
  allowMutations?: boolean;
  allowDestructive?: boolean;
  includeApprovalRequired?: boolean;
  sourceMode?: "all" | "orpc-app-state" | "mcp" | "sandbox" | "local-ui";
};

export type ToolPolicyDecision = {
  decision: "allow" | "approval_required" | "deny";
  reasons: string[];
};

const mutationVerbPattern = /(^|\.)(create|update|patch|delete|remove|cancel|confirm|assign|unassign|reserve|commit|send|upload|open|add|post)(\.|$)/i;
const destructiveVerbPattern = /(^|\.)(delete|remove|destroy|purge|void|revoke|unassign)(\.|$)/i;
const arbitraryEndpointPattern = /(^https?:\/\/)|[\s]|\//i;
const validProcedurePattern = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)+$/i;

export function createToolManifest(provider: string, tools: ToolContractEntry[], generatedAt = new Date().toISOString()): ToolManifest {
  return toolManifestSchema.parse({ version: "sonik-agent-ui.tool-manifest.v1", generatedAt, provider, tools });
}

export function inferEffectFromHttpMethod(method?: string): ToolEffect {
  const normalized = method?.toUpperCase();
  if (!normalized) return "unknown";
  if (["GET", "HEAD", "OPTIONS"].includes(normalized)) return "read";
  if (["POST", "PUT", "PATCH"].includes(normalized)) return "write";
  if (normalized === "DELETE") return "destructive";
  return "unknown";
}

export function inferEffectFromProcedureId(id: string, defaultEffect: ToolEffect = "unknown"): ToolEffect {
  if (destructiveVerbPattern.test(id)) return "destructive";
  if (mutationVerbPattern.test(id)) return "write";
  if (/(^|\.)(get|list|read|search|lookup|preview|learn|catalog|find)(\.|$)/i.test(id)) return "read";
  return defaultEffect;
}

export function isValidOrpcProcedureId(id: string): boolean {
  if (arbitraryEndpointPattern.test(id)) return false;
  return validProcedurePattern.test(id);
}

export function normalizeToolEntry(entry: ToolContractEntry): ToolContractEntry {
  const parsed = toolContractEntrySchema.parse(entry);
  const inferredEffect = parsed.effect === "unknown" ? inferEffectFromProcedureId(parsed.id, parsed.effect) : parsed.effect;
  return {
    ...parsed,
    effect: inferredEffect,
    approval: normalizeApproval(parsed.approval, inferredEffect),
  };
}

export function evaluateToolPolicy(tool: ToolContractEntry, context: ToolAvailabilityContext = {}): ToolPolicyDecision {
  const entry = normalizeToolEntry(tool);
  const reasons: string[] = [];

  if (context.sourceMode === "orpc-app-state" && entry.source !== "orpc" && entry.source !== "openapi") {
    return { decision: "deny", reasons: ["source_not_orpc_app_state"] };
  }
  if (context.sourceMode === "mcp" && entry.source !== "mcp") {
    return { decision: "deny", reasons: ["source_not_mcp"] };
  }
  if (context.sourceMode === "sandbox" && entry.source !== "sandbox") {
    return { decision: "deny", reasons: ["source_not_sandbox"] };
  }
  if (context.sourceMode === "local-ui" && entry.source !== "local-ui") {
    return { decision: "deny", reasons: ["source_not_local_ui"] };
  }

  if (entry.source === "orpc" && !isValidOrpcProcedureId(entry.transport.procedure ?? entry.id)) {
    reasons.push("invalid_orpc_procedure_id");
  }
  if (entry.source === "sandbox" && context.sourceMode === "orpc-app-state") {
    reasons.push("sandbox_not_app_state");
  }
  if (entry.auth.required && context.authenticated !== true) {
    reasons.push("auth_required");
  }
  if (entry.auth.orgScoped && !context.organizationId) {
    reasons.push("organization_required");
  }
  const contextScopes = new Set(context.scopes ?? []);
  const missingScopes = entry.auth.scopes.filter((scope) => !contextScopes.has(scope));
  if (missingScopes.length > 0) {
    reasons.push(`missing_scopes:${missingScopes.join(",")}`);
  }
  if (entry.approval === "denied") {
    reasons.push("tool_denied_by_manifest");
  }
  if (entry.effect === "unknown") {
    reasons.push("unknown_effect_denied");
  }
  if (entry.effect === "environment" && entry.source !== "sandbox") {
    reasons.push("environment_effect_requires_sandbox_source");
  }
  if (entry.effect === "write" && context.allowMutations !== true && entry.approval !== "required") {
    reasons.push("write_requires_approval_or_mutation_context");
  }
  if (entry.effect === "destructive" && context.allowDestructive !== true) {
    reasons.push("destructive_requires_explicit_approval");
  }

  if (reasons.length > 0) {
    const approvalGateOnly = reasons.every((reason) =>
      ["write_requires_approval_or_mutation_context", "destructive_requires_explicit_approval"].includes(reason)
    ) && entry.approval === "required";
    return approvalGateOnly ? { decision: "approval_required", reasons } : { decision: "deny", reasons };
  }

  if (entry.approval === "required") {
    return { decision: "approval_required", reasons: ["manifest_requires_approval"] };
  }

  return { decision: "allow", reasons: ["policy_allowed"] };
}

export function filterAvailableTools(manifest: ToolManifest, context: ToolAvailabilityContext = {}): ToolManifest {
  const tools = manifest.tools
    .map(normalizeToolEntry)
    .map((tool) => ({ tool, policy: evaluateToolPolicy(tool, context) }))
    .filter(({ policy }) => policy.decision === "allow" || (context.includeApprovalRequired === true && policy.decision === "approval_required"))
    .map(({ tool, policy }) => ({
      ...tool,
      approval: policy.decision === "approval_required" ? "required" : tool.approval,
      metadata: { ...tool.metadata, policyDecision: policy.decision, policyReasons: policy.reasons },
    }));

  return createToolManifest(manifest.provider, tools, manifest.generatedAt);
}

export function summarizeToolManifest(manifest: ToolManifest): string {
  const bySource = countBy(manifest.tools.map((tool) => tool.source));
  const byEffect = countBy(manifest.tools.map((tool) => tool.effect));
  const lines = [
    `Tool manifest ${manifest.provider}: ${manifest.tools.length} tools`,
    `sources=${formatCounts(bySource)}`,
    `effects=${formatCounts(byEffect)}`,
  ];
  for (const tool of manifest.tools.slice(0, 20)) {
    lines.push(`- ${tool.id} [${tool.source}/${tool.effect}/${tool.approval}] targets=${tool.uiTargets.join(",")}: ${tool.title}`);
  }
  if (manifest.tools.length > 20) lines.push(`- ...${manifest.tools.length - 20} more`);
  return lines.join("\n");
}

function normalizeApproval(approval: ToolApproval, effect: ToolEffect): ToolApproval {
  if (approval !== "none") return approval;
  if (effect === "write" || effect === "destructive" || effect === "environment") return "required";
  if (effect === "unknown") return "denied";
  return "none";
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([key, value]) => `${key}:${value}`).join(",") || "none";
}

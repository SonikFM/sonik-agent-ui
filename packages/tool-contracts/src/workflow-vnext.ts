import { z } from "zod";
import { capabilityIdSchema, findCapability, type CapabilityRegistry } from "./capability-registry.ts";
import { marketplaceCommandEffectSchema, workflowDefinitionSchema, type WorkflowDefinition } from "./marketplace.js";

export const WORKFLOW_VNEXT_SCHEMA_VERSION = "sonik.workflow.vnext.v1" as const;
export const WORKFLOW_EVENT_SCHEMA_VERSION = "sonik.workflow.event.v1" as const;
export const MAX_INLINE_OUTPUT_BYTES = 64 * 1024;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 lowercase hex characters>");
export const workflowSchemaRefSchema = z.object({
  schemaId: z.string().min(1),
  version: z.number().int().positive(),
  digest: sha256DigestSchema,
}).strict();
export type WorkflowSchemaRef = z.infer<typeof workflowSchemaRefSchema>;

export const workflowBindingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("constant"), value: jsonValueSchema }).strict(),
  z.object({ source: z.literal("run_input"), path: z.array(z.string().min(1)).default([]) }).strict(),
  z.object({ source: z.literal("node_output"), nodeId: z.string().min(1), path: z.array(z.string().min(1)).default([]) }).strict(),
  z.object({ source: z.literal("host_context"), key: z.string().min(1) }).strict(),
]);
export type WorkflowBinding = z.infer<typeof workflowBindingSchema>;

const predicateOperandSchema = z.union([workflowBindingSchema, z.object({ value: jsonValueSchema }).strict()]);
export const workflowPredicateSchema = z.object({
  operator: z.enum(["eq", "not_eq", "gt", "gte", "lt", "lte", "in", "exists"]),
  left: workflowBindingSchema,
  right: predicateOperandSchema.optional(),
}).strict().superRefine((predicate, ctx) => {
  if (predicate.operator !== "exists" && !predicate.right) {
    ctx.addIssue({ code: "custom", path: ["right"], message: `${predicate.operator} requires a right operand` });
  }
  if (predicate.operator === "exists" && predicate.right) {
    ctx.addIssue({ code: "custom", path: ["right"], message: "exists does not accept a right operand" });
  }
});
export type WorkflowPredicate = z.infer<typeof workflowPredicateSchema>;

export const WORKFLOW_VNEXT_NODE_TYPES = [
  "trigger", "ask_user", "skill", "reasoning", "artifact", "evidence", "tool_preview", "approval", "tool_commit", "branch",
  "remote_execution", "creative", "promotion",
] as const;
export const workflowVNextNodeTypeSchema = z.enum(WORKFLOW_VNEXT_NODE_TYPES);
export type WorkflowVNextNodeType = z.infer<typeof workflowVNextNodeTypeSchema>;

export const workflowNodeDescriptorSchema = z.object({
  nodeType: workflowVNextNodeTypeSchema,
  typeVersion: z.number().int().positive(),
  configSchema: workflowSchemaRefSchema,
  inputSchema: workflowSchemaRefSchema,
  outputSchema: workflowSchemaRefSchema,
  effect: marketplaceCommandEffectSchema,
}).strict();
export type WorkflowNodeDescriptor = z.infer<typeof workflowNodeDescriptorSchema>;

export type WorkflowSchemaRegistry = ReadonlyMap<string, z.ZodType> | Readonly<Record<string, z.ZodType>>;
export interface WorkflowRuntimeRegistry {
  descriptors: readonly WorkflowNodeDescriptor[];
  schemas: WorkflowSchemaRegistry;
}

export function workflowSchemaRefKey(ref: WorkflowSchemaRef): string {
  return `${ref.schemaId}@${ref.version}:${ref.digest}`;
}

function resolveWorkflowSchema(registry: WorkflowSchemaRegistry, ref: WorkflowSchemaRef): z.ZodType | undefined {
  const key = workflowSchemaRefKey(ref);
  return "get" in registry && typeof registry.get === "function"
    ? registry.get(key)
    : (registry as Readonly<Record<string, z.ZodType>>)[key];
}

export const workflowNodeDescriptorRegistrySchema = z.array(workflowNodeDescriptorSchema).min(1).superRefine((descriptors, ctx) => {
  const identities = new Set<string>();
  descriptors.forEach((descriptor, index) => {
    const identity = `${descriptor.nodeType}@${descriptor.typeVersion}`;
    if (identities.has(identity)) ctx.addIssue({ code: "custom", path: [index], message: `Duplicate node descriptor ${identity}` });
    identities.add(identity);
  });
});

export const artifactRefSchema = z.object({
  artifactId: z.string().min(1),
  organizationId: z.string().min(1),
  contentType: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  digest: sha256DigestSchema,
  createdByNodeId: z.string().min(1),
}).strict();
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const boundedNodeOutputSchema = z.discriminatedUnion("storage", [
  z.object({ storage: z.literal("inline"), value: jsonValueSchema, byteLength: z.number().int().nonnegative().max(MAX_INLINE_OUTPUT_BYTES) }).strict()
    .superRefine((output, ctx) => {
      const actual = new TextEncoder().encode(JSON.stringify(output.value)).byteLength;
      if (output.byteLength !== actual) ctx.addIssue({ code: "custom", path: ["byteLength"], message: "byteLength must match the encoded JSON output" });
    }),
  z.object({ storage: z.literal("artifact"), artifact: artifactRefSchema }).strict(),
]);
export type BoundedNodeOutput = z.infer<typeof boundedNodeOutputSchema>;

export const exactEffectBindingSchema = z.object({
  commandId: z.string().min(1),
  previewNodeId: z.string().min(1),
  approvalNodeId: z.string().min(1),
  logicalEffectId: z.string().min(1),
  resolvedInputHash: sha256DigestSchema,
}).strict();
export type ExactEffectBinding = z.infer<typeof exactEffectBindingSchema>;

export const externalEffectIdentitySchema = z.object({
  namespace: z.string().min(1),
  keyDigest: sha256DigestSchema,
  commandId: z.string().min(1),
  resolvedInputHash: sha256DigestSchema,
}).strict();
export type ExternalEffectIdentity = z.infer<typeof externalEffectIdentitySchema>;

export const previewEffectIdentitySchema = exactEffectBindingSchema.pick({
  commandId: true,
  logicalEffectId: true,
  resolvedInputHash: true,
});
export const approvalEffectIdentitySchema = exactEffectBindingSchema.extend({
  commitNodeId: z.string().min(1),
});

export const reasoningExecutionContractSchema = z.object({
  structuredOutputSchema: workflowSchemaRefSchema,
  budgets: z.object({
    maxSteps: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    maxWallTimeMs: z.number().int().positive(),
  }).strict(),
  nestedCapabilityEffects: z.array(z.enum(["none", "read"])).default([]),
}).strict();

export const workflowVNextNodeSchema = z.object({
  nodeId: z.string().min(1),
  nodeType: workflowVNextNodeTypeSchema,
  typeVersion: z.number().int().positive(),
  config: jsonValueSchema,
  bindings: z.record(z.string(), workflowBindingSchema).default({}),
  requiredHostContext: z.array(z.string().min(1)).default([]),
  capabilityPins: z.array(capabilityIdSchema).default([]),
  output: z.object({ inlineByteLimit: z.number().int().positive().max(MAX_INLINE_OUTPUT_BYTES) }).strict(),
  previewEffect: previewEffectIdentitySchema.optional(),
  approvalEffect: approvalEffectIdentitySchema.optional(),
  effectBinding: exactEffectBindingSchema.optional(),
  reasoning: reasoningExecutionContractSchema.optional(),
}).strict();
export type WorkflowVNextNode = z.infer<typeof workflowVNextNodeSchema>;

export const workflowVNextEdgeSchema = z.object({
  edgeId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  predicate: workflowPredicateSchema.optional(),
  default: z.boolean().default(false),
}).strict().superRefine((edge, ctx) => {
  if (edge.default && edge.predicate) ctx.addIssue({ code: "custom", path: ["predicate"], message: "A default edge cannot also declare a predicate" });
});
export type WorkflowVNextEdge = z.infer<typeof workflowVNextEdgeSchema>;

export const workflowVNextDefinitionSchema = z.object({
  schemaVersion: z.literal(WORKFLOW_VNEXT_SCHEMA_VERSION),
  workflowId: z.string().min(1),
  definitionVersion: z.number().int().positive(),
  title: z.string().min(1),
  entryNodeId: z.string().min(1),
  nodes: z.array(workflowVNextNodeSchema).min(1),
  edges: z.array(workflowVNextEdgeSchema).default([]),
  facadeToolIds: z.array(z.string().min(1)).max(5).default([]),
}).strict();
export type WorkflowVNextDefinition = z.infer<typeof workflowVNextDefinitionSchema>;

export const INITIAL_WORKFLOW_PUBLISH_SUPPORT = {
  trigger: true, ask_user: true, skill: true, reasoning: true, artifact: true, evidence: true,
  tool_preview: true, approval: true, tool_commit: true, branch: true,
  remote_execution: false, creative: false, promotion: false,
} as const satisfies Record<WorkflowVNextNodeType, boolean>;

export interface WorkflowPublishIssue { path: Array<string | number>; code: string; message: string }
export type WorkflowPublishValidation = { ok: true; definition: WorkflowVNextDefinition } | { ok: false; issues: WorkflowPublishIssue[] };

const MUTATING_EFFECTS = new Set(["write", "destructive", "external"]);

export function validateWorkflowForPublish(input: unknown, registry: WorkflowRuntimeRegistry): WorkflowPublishValidation {
  const parsed = workflowVNextDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String), code: "schema_invalid", message: issue.message })) };
  }
  const definition = parsed.data;
  const issues: WorkflowPublishIssue[] = [];
  const descriptors = new Map(registry.descriptors.map((descriptor) => [`${descriptor.nodeType}@${descriptor.typeVersion}`, descriptor]));
  const nodes = new Map<string, WorkflowVNextNode>();
  const previewBindings = new Set<string>();
  const approvalBindings = new Set<string>();
  const logicalEffectIds = new Set<string>();
  definition.nodes.forEach((node, index) => {
    if (nodes.has(node.nodeId)) issues.push({ path: ["nodes", index, "nodeId"], code: "duplicate_node", message: `Duplicate node ${node.nodeId}` });
    nodes.set(node.nodeId, node);
    const descriptor = descriptors.get(`${node.nodeType}@${node.typeVersion}`);
    if (!descriptor) issues.push({ path: ["nodes", index], code: "unsupported_node_version", message: `Unsupported descriptor ${node.nodeType}@${node.typeVersion}` });
    else {
      const configSchema = resolveWorkflowSchema(registry.schemas, descriptor.configSchema);
      if (!configSchema) issues.push({ path: ["nodes", index, "config"], code: "descriptor_schema_missing", message: `Missing config schema ${workflowSchemaRefKey(descriptor.configSchema)}` });
      else if (!configSchema.safeParse(node.config).success) issues.push({ path: ["nodes", index, "config"], code: "config_schema_invalid", message: `Config does not match ${descriptor.configSchema.schemaId}` });
      if (!resolveWorkflowSchema(registry.schemas, descriptor.inputSchema) || !resolveWorkflowSchema(registry.schemas, descriptor.outputSchema)) {
        issues.push({ path: ["nodes", index], code: "descriptor_schema_missing", message: "Descriptor input/output schemas must be registered" });
      }
      const mutatingDescriptor = MUTATING_EFFECTS.has(descriptor.effect);
      if ((node.nodeType === "tool_commit") !== mutatingDescriptor || (node.nodeType === "tool_preview" && descriptor.effect !== "read")) {
        issues.push({ path: ["nodes", index], code: "descriptor_effect_mismatch", message: `${node.nodeType} is incompatible with descriptor effect ${descriptor.effect}` });
      }
    }
    if (!INITIAL_WORKFLOW_PUBLISH_SUPPORT[node.nodeType]) issues.push({ path: ["nodes", index], code: "node_not_publishable", message: `${node.nodeType} is not initially publishable` });
    for (const binding of Object.values(node.bindings)) {
      if (binding.source === "node_output" && binding.nodeId === node.nodeId) issues.push({ path: ["nodes", index, "bindings"], code: "self_binding", message: "A node cannot bind its own output" });
    }
    if (node.nodeType === "tool_commit") {
      const binding = node.effectBinding;
      if (!binding) issues.push({ path: ["nodes", index, "effectBinding"], code: "effect_binding_required", message: "Commit nodes require an exact effect binding" });
      else {
        const preview = definition.nodes.find((candidate) => candidate.nodeId === binding.previewNodeId);
        const approval = definition.nodes.find((candidate) => candidate.nodeId === binding.approvalNodeId);
        if (preview?.nodeType !== "tool_preview") issues.push({ path: ["nodes", index, "effectBinding", "previewNodeId"], code: "invalid_preview_binding", message: "previewNodeId must identify a tool_preview node" });
        if (approval?.nodeType !== "approval") issues.push({ path: ["nodes", index, "effectBinding", "approvalNodeId"], code: "invalid_approval_binding", message: "approvalNodeId must identify an approval node" });
        const sameEffect = (candidate?: { commandId: string; logicalEffectId: string; resolvedInputHash: string }): boolean => Boolean(candidate
          && candidate.commandId === binding.commandId
          && candidate.logicalEffectId === binding.logicalEffectId
          && candidate.resolvedInputHash === binding.resolvedInputHash);
        if (!sameEffect(preview?.previewEffect)) issues.push({ path: ["nodes", index, "effectBinding", "previewNodeId"], code: "preview_effect_mismatch", message: "Preview must bind the exact command, input hash, and logical effect" });
        if (!sameEffect(approval?.approvalEffect) || approval?.approvalEffect?.previewNodeId !== binding.previewNodeId || approval.approvalEffect.approvalNodeId !== binding.approvalNodeId || approval.approvalEffect.commitNodeId !== node.nodeId) issues.push({ path: ["nodes", index, "effectBinding", "approvalNodeId"], code: "approval_effect_mismatch", message: "Approval must bind the exact preview, commit, command, input hash, and logical effect" });
        if (!node.requiredHostContext.length) issues.push({ path: ["nodes", index, "requiredHostContext"], code: "host_context_required", message: "Commit nodes require authorized host context" });
        if (!node.capabilityPins.includes(binding.commandId) || !definition.facadeToolIds.includes(binding.commandId)) issues.push({ path: ["nodes", index], code: "capability_pin_required", message: "Commit nodes require capability and facade pins" });
        if (previewBindings.has(binding.previewNodeId)) issues.push({ path: ["nodes", index, "effectBinding", "previewNodeId"], code: "preview_binding_reused", message: "Each commit requires its own preview" });
        if (approvalBindings.has(binding.approvalNodeId)) issues.push({ path: ["nodes", index, "effectBinding", "approvalNodeId"], code: "approval_binding_reused", message: "Each commit requires its own approval" });
        if (logicalEffectIds.has(binding.logicalEffectId)) issues.push({ path: ["nodes", index, "effectBinding", "logicalEffectId"], code: "logical_effect_reused", message: "Each resolved effect requires a unique logicalEffectId" });
        previewBindings.add(binding.previewNodeId);
        approvalBindings.add(binding.approvalNodeId);
        logicalEffectIds.add(binding.logicalEffectId);
      }
    }
    if (node.nodeType === "tool_preview" && !node.previewEffect) issues.push({ path: ["nodes", index, "previewEffect"], code: "preview_effect_required", message: "Preview nodes require an exact effect identity" });
    if (node.nodeType === "approval" && !node.approvalEffect) issues.push({ path: ["nodes", index, "approvalEffect"], code: "approval_effect_required", message: "Approval nodes require an exact effect identity" });
    if (node.nodeType === "reasoning" && !node.reasoning) issues.push({ path: ["nodes", index, "reasoning"], code: "reasoning_contract_required", message: "Reasoning nodes require structured output and execution budgets" });
  });
  if (!nodes.has(definition.entryNodeId)) issues.push({ path: ["entryNodeId"], code: "missing_entry", message: "entryNodeId must identify a node" });

  const outgoing = new Map<string, WorkflowVNextEdge[]>();
  const incoming = new Map<string, number>();
  definition.edges.forEach((edge, index) => {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) issues.push({ path: ["edges", index], code: "dangling_edge", message: "Edges must reference existing nodes" });
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  });
  for (const [nodeId, count] of incoming) if (count > 1) issues.push({ path: ["nodes", nodeId], code: "parallel_fan_in", message: "Parallel fan-in is not initially supported" });
  for (const [nodeId, edges] of outgoing) {
    const node = nodes.get(nodeId);
    if (node?.nodeType !== "branch" && edges.length > 1) issues.push({ path: ["nodes", nodeId], code: "ambiguous_outgoing_edge", message: "Non-branch nodes may have at most one outgoing edge" });
    if (node?.nodeType === "branch") {
      if (edges.filter((edge) => edge.default).length > 1) issues.push({ path: ["nodes", nodeId], code: "multiple_default_edges", message: "Branch nodes may have at most one default edge" });
      if (edges.some((edge) => !edge.default && !edge.predicate)) issues.push({ path: ["nodes", nodeId], code: "branch_predicate_required", message: "Non-default branch edges require a structured predicate" });
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) { issues.push({ path: ["nodes", nodeId], code: "cycle", message: "Cycles are not initially supported" }); return; }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) visit(edge.to);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  if (nodes.has(definition.entryNodeId)) visit(definition.entryNodeId);
  const precedes = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (seen.has(from)) return false;
    seen.add(from);
    return (outgoing.get(from) ?? []).some((edge) => edge.to === to || precedes(edge.to, to, seen));
  };
  definition.nodes.forEach((node, index) => {
    if (!visited.has(node.nodeId)) issues.push({ path: ["nodes", index], code: "unreachable_node", message: `Node ${node.nodeId} is unreachable from entryNodeId` });
    for (const binding of Object.values(node.bindings)) {
      if (binding.source === "node_output" && (!nodes.has(binding.nodeId) || !precedes(binding.nodeId, node.nodeId))) issues.push({ path: ["nodes", index, "bindings"], code: "unbound_node_output", message: `Binding must reference a prior node output: ${binding.nodeId}` });
    }
    if (node.nodeType === "tool_commit" && node.effectBinding) {
      if (!precedes(node.effectBinding.previewNodeId, node.effectBinding.approvalNodeId) || !precedes(node.effectBinding.approvalNodeId, node.nodeId)) {
        issues.push({ path: ["nodes", index, "effectBinding"], code: "invalid_effect_order", message: "Commit topology must order preview before approval before commit" });
      }
    }
  });
  return issues.length ? { ok: false, issues } : { ok: true, definition };
}

export const workflowDefinitionRecordSchema = z.object({
  organizationId: z.string().min(1), workflowId: z.string().min(1), draftRevision: z.number().int().nonnegative(),
  draft: workflowVNextDefinitionSchema, createdBy: z.string().min(1), updatedBy: z.string().min(1),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export const publishedWorkflowVersionSchema = z.object({
  organizationId: z.string().min(1), workflowId: z.string().min(1), versionId: z.string().min(1),
  definitionDigest: sha256DigestSchema, definition: workflowVNextDefinitionSchema, sourceDraftRevision: z.number().int().nonnegative(),
  publishedBy: z.string().min(1), publishedAt: z.string().datetime(),
}).strict();
export function validatePublishedWorkflowVersion(input: unknown, registry: WorkflowRuntimeRegistry): WorkflowPublishValidation {
  const parsed = publishedWorkflowVersionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String), code: "schema_invalid", message: issue.message })) };
  return validateWorkflowForPublish(parsed.data.definition, registry);
}
export const workflowRunSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("published"), organizationId: z.string().min(1), workflowVersionId: z.string().min(1), definitionDigest: sha256DigestSchema }).strict(),
  z.object({ kind: z.literal("debug_draft"), organizationId: z.string().min(1), workflowId: z.string().min(1), draftRevision: z.number().int().nonnegative(), definitionDigest: sha256DigestSchema, executionMode: z.literal("read_preview_only") }).strict(),
]);

export const workflowWaitpointSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer"), waitpointId: z.string().min(1), runId: z.string().min(1), nodeId: z.string().min(1), subjectId: z.string().min(1), expiresAt: z.string().datetime().optional() }).strict(),
  z.object({ kind: z.literal("approval"), waitpointId: z.string().min(1), runId: z.string().min(1), nodeId: z.string().min(1), subjectId: z.string().min(1), logicalEffectId: z.string().min(1), expiresAt: z.string().datetime() }).strict(),
  z.object({ kind: z.literal("budget_yield"), waitpointId: z.string().min(1), runId: z.string().min(1), nodeId: z.string().min(1), wakeupReason: z.enum(["node_budget_exhausted", "wall_time_budget_exhausted"]), resumeAfter: z.string().datetime().optional() }).strict(),
]);
export type WorkflowWaitpoint = z.infer<typeof workflowWaitpointSchema>;

export const workflowErrorSchema = z.object({ code: z.string().min(1), message: z.string().min(1), retrySafe: z.boolean() }).strict();
export function workflowEffectIdempotencyKey(workflowRunId: string, logicalEffectId: string): string {
  return `${workflowRunId}:${logicalEffectId}`;
}
export function externalEffectIdempotencyKey(identity: ExternalEffectIdentity): string {
  return `${identity.namespace}:${identity.keyDigest}`;
}
export const engineRequestSchema = z.object({
  workflowRunId: z.string().min(1), workflowVersionId: z.string().min(1), nodeId: z.string().min(1),
  nodeType: workflowVNextNodeTypeSchema, typeVersion: z.number().int().positive(), attempt: z.number().int().positive(),
  attemptId: z.string().min(1), logicalEffectId: z.string().min(1).optional(), input: jsonValueSchema,
  contextSnapshot: z.record(z.string(), jsonValueSchema), capabilityPins: z.array(capabilityIdSchema), idempotencyKey: z.string().min(1),
  externalEffectIdentity: externalEffectIdentitySchema.optional(),
}).strict().superRefine((request, ctx) => {
  const expected = request.externalEffectIdentity ? externalEffectIdempotencyKey(request.externalEffectIdentity) : request.logicalEffectId ? workflowEffectIdempotencyKey(request.workflowRunId, request.logicalEffectId) : undefined;
  if (expected && request.idempotencyKey !== expected) ctx.addIssue({ code: "custom", path: ["idempotencyKey"], message: "Effect idempotencyKey must match its trusted effect identity" });
});
export const engineResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("succeeded"), output: boundedNodeOutputSchema, receipt: z.object({ receiptId: z.string().min(1), semanticStatus: z.literal("success") }).strict().optional() }).strict(),
  z.object({ status: z.literal("waiting"), waitpoint: workflowWaitpointSchema }).strict(),
  z.object({ status: z.literal("retryable_error"), error: workflowErrorSchema.refine((error) => error.retrySafe, "retryable errors must be marked retrySafe") }).strict(),
  z.object({ status: z.literal("terminal_error"), error: workflowErrorSchema }).strict(),
]);
export type EngineRequest = z.infer<typeof engineRequestSchema>;
export type EngineResponse = z.infer<typeof engineResponseSchema>;

function resolveNodeDescriptor(registry: WorkflowRuntimeRegistry, nodeType: WorkflowVNextNodeType, typeVersion: number): WorkflowNodeDescriptor {
  const descriptor = registry.descriptors.find((candidate) => candidate.nodeType === nodeType && candidate.typeVersion === typeVersion);
  if (!descriptor) throw new Error(`unsupported_node_version:${nodeType}@${typeVersion}`);
  return descriptor;
}

export function parseEngineRequestForRegistry(input: unknown, registry: WorkflowRuntimeRegistry): EngineRequest {
  const request = engineRequestSchema.parse(input);
  const descriptor = resolveNodeDescriptor(registry, request.nodeType, request.typeVersion);
  const inputSchema = resolveWorkflowSchema(registry.schemas, descriptor.inputSchema);
  if (!inputSchema) throw new Error(`descriptor_schema_missing:${workflowSchemaRefKey(descriptor.inputSchema)}`);
  inputSchema.parse(request.input);
  if (MUTATING_EFFECTS.has(descriptor.effect) && !request.logicalEffectId) throw new Error("invalid_effect_idempotency");
  if (!MUTATING_EFFECTS.has(descriptor.effect) && request.logicalEffectId) throw new Error("logical_effect_on_non_mutating_node");
  return request;
}

export function parseEngineResponseForRegistry(requestInput: unknown, responseInput: unknown, registry: WorkflowRuntimeRegistry): EngineResponse {
  const request = parseEngineRequestForRegistry(requestInput, registry);
  const descriptor = resolveNodeDescriptor(registry, request.nodeType, request.typeVersion);
  const response = engineResponseSchema.parse(responseInput);
  if (response.status === "succeeded") {
    if (MUTATING_EFFECTS.has(descriptor.effect) && !response.receipt) throw new Error("semantic_receipt_required");
    if (response.output.storage === "inline") {
      const outputSchema = resolveWorkflowSchema(registry.schemas, descriptor.outputSchema);
      if (!outputSchema) throw new Error(`descriptor_schema_missing:${workflowSchemaRefKey(descriptor.outputSchema)}`);
      outputSchema.parse(response.output.value);
    }
  }
  return response;
}

export const approvalDecisionSchema = z.object({
  decisionId: z.string().min(1), decision: z.enum(["approved", "rejected"]), runId: z.string().min(1), approvalNodeId: z.string().min(1),
  previewNodeId: z.string().min(1), commitNodeId: z.string().min(1), commandId: z.string().min(1), logicalEffectId: z.string().min(1), organizationId: z.string().min(1),
  approverId: z.string().min(1), grantEvidenceDigest: sha256DigestSchema, resolvedInputHash: sha256DigestSchema,
  externalEffectIdentity: externalEffectIdentitySchema,
  issuedAt: z.string().datetime(), expiresAt: z.string().datetime(), hostSigned: z.literal(true),
}).strict();
export const publicApprovalDecisionRequestSchema = approvalDecisionSchema.omit({ hostSigned: true, externalEffectIdentity: true }).strict();
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export const approvalCommitContextSchema = z.object({
  runId: z.string().min(1), organizationId: z.string().min(1), evaluatedAt: z.string().datetime(), externalEffectIdentity: externalEffectIdentitySchema,
}).strict();
export type ApprovalCommitContext = z.infer<typeof approvalCommitContextSchema>;

export function validateApprovalDecisionForCommit(
  decisionInput: unknown,
  definitionInput: unknown,
  commitNodeId: string,
  expectedContextInput: unknown,
): ApprovalDecision {
  const decision = approvalDecisionSchema.parse(decisionInput);
  const expectedContext = approvalCommitContextSchema.parse(expectedContextInput);
  const definition = workflowVNextDefinitionSchema.parse(definitionInput);
  if (decision.runId !== expectedContext.runId || decision.organizationId !== expectedContext.organizationId) throw new Error("approval_context_mismatch");
  const evaluatedAt = Date.parse(expectedContext.evaluatedAt);
  if (evaluatedAt < Date.parse(decision.issuedAt)) throw new Error("approval_decision_not_yet_valid");
  if (evaluatedAt >= Date.parse(decision.expiresAt)) throw new Error("approval_decision_expired");
  const commit = definition.nodes.find((node) => node.nodeId === commitNodeId && node.nodeType === "tool_commit");
  if (!commit?.effectBinding) throw new Error("commit_effect_binding_missing");
  const binding = commit.effectBinding;
  if (decision.decision !== "approved" || decision.commitNodeId !== commit.nodeId || decision.approvalNodeId !== binding.approvalNodeId || decision.previewNodeId !== binding.previewNodeId || decision.commandId !== binding.commandId || decision.logicalEffectId !== binding.logicalEffectId || decision.resolvedInputHash !== binding.resolvedInputHash) {
    throw new Error("approval_effect_binding_mismatch");
  }
  if (JSON.stringify(decision.externalEffectIdentity) !== JSON.stringify(expectedContext.externalEffectIdentity)) throw new Error("approval_external_effect_identity_mismatch");
  return decision;
}

export const effectClaimStatusSchema = z.enum(["claimed", "in_flight", "succeeded", "failed", "outcome_unknown", "reconciled"]);
export const effectClaimSchema = z.object({
  claimId: z.string().min(1), runId: z.string().min(1), logicalEffectId: z.string().min(1), attemptId: z.string().min(1),
  idempotencyKey: z.string().min(1), providerSupportsIdempotency: z.boolean(), externalEffectIdentity: externalEffectIdentitySchema, status: effectClaimStatusSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
const EFFECT_CLAIM_TRANSITIONS: Record<z.infer<typeof effectClaimStatusSchema>, readonly z.infer<typeof effectClaimStatusSchema>[]> = {
  claimed: ["in_flight"], in_flight: ["succeeded", "failed", "outcome_unknown"], succeeded: [], failed: [], outcome_unknown: ["reconciled"], reconciled: [],
};
export function canTransitionEffectClaim(from: z.infer<typeof effectClaimStatusSchema>, to: z.infer<typeof effectClaimStatusSchema>): boolean {
  return EFFECT_CLAIM_TRANSITIONS[from].includes(to);
}

export const workflowDependencyPinsSchema = z.object({
  organizationId: z.string().min(1), workflowVersionId: z.string().min(1), definitionDigest: sha256DigestSchema,
  agentPublishedVersionId: z.string().min(1), nodeDescriptorsDigest: sha256DigestSchema,
  capabilityVersionsDigest: sha256DigestSchema, toolPackVersionsDigest: sha256DigestSchema,
  skillVersionsDigest: sha256DigestSchema, runtimePolicyDigest: sha256DigestSchema,
}).strict();
export type WorkflowDependencyPins = z.infer<typeof workflowDependencyPinsSchema>;

export const workflowRunStatusSchema = z.enum(["ready", "running", "waiting", "succeeded", "failed", "cancelled"]);
export const workflowNodeAttemptSchema = z.object({
  workflowRunId: z.string().min(1), nodeId: z.string().min(1), attempt: z.number().int().positive(), attemptId: z.string().min(1),
  status: z.enum(["started", "waiting", "succeeded", "failed", "cancelled"]), inputHash: sha256DigestSchema,
  idempotencyKey: z.string().min(1), startedAt: z.string().datetime(), finishedAt: z.string().datetime().optional(), errorCode: z.string().min(1).optional(),
}).strict();
export const workflowEventOutputRefSchema = z.discriminatedUnion("storage", [
  z.object({ storage: z.literal("inline_redacted"), digest: sha256DigestSchema, byteLength: z.number().int().nonnegative().max(MAX_INLINE_OUTPUT_BYTES), redactedSummary: z.string().min(1).max(256) }).strict(),
  z.object({ storage: z.literal("artifact"), artifact: artifactRefSchema }).strict(),
]);
export const workflowVNextRunStateSchema = z.object({
  workflowRunId: z.string().min(1), organizationId: z.string().min(1), source: workflowRunSourceSchema,
  status: workflowRunStatusSchema, revision: z.number().int().nonnegative(), selectedPath: z.array(z.string().min(1)),
  eventSequence: z.number().int().nonnegative().default(0), schedulerFrontier: z.array(z.string().min(1)), outputs: z.record(z.string(), boundedNodeOutputSchema),
  outputRefs: z.record(z.string(), workflowEventOutputRefSchema).default({}), waits: z.array(workflowWaitpointSchema),
  compatibilityPhase: z.string().min(1), dependencyPins: workflowDependencyPinsSchema,
}).strict();

export const runUntilBlockedBudgetSchema = z.object({ maxNodes: z.number().int().positive(), maxWallTimeMs: z.number().int().positive() }).strict();
export const runLeaseSchema = z.object({ leaseId: z.string().min(1), ownerId: z.string().min(1), expiresAt: z.string().datetime() }).strict();
const resumeEventBase = {
  eventId: z.string().min(1), waitpointId: z.string().min(1), workflowRunId: z.string().min(1), organizationId: z.string().min(1),
  nodeId: z.string().min(1), runRevision: z.number().int().nonnegative(), subjectId: z.string().min(1), issuedAt: z.string().datetime(),
  authenticationEvidenceDigest: sha256DigestSchema,
} as const;
const publicResumeEventBase = {
  eventId: z.string().min(1), waitpointId: z.string().min(1), workflowRunId: z.string().min(1),
  nodeId: z.string().min(1), runRevision: z.number().int().nonnegative(), issuedAt: z.string().datetime(),
} as const;
export const publicResumeEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...publicResumeEventBase, kind: z.literal("answer"), answer: jsonValueSchema }).strict(),
  z.object({ ...publicResumeEventBase, kind: z.literal("approval"), logicalEffectId: z.string().min(1) }).strict(),
]);
export const authenticatedResumeEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...resumeEventBase, kind: z.literal("answer"), answer: jsonValueSchema }).strict(),
  z.object({ ...resumeEventBase, kind: z.literal("approval"), logicalEffectId: z.string().min(1) }).strict(),
]);
export const runDriverPumpRequestSchema = z.object({
  workflowRunId: z.string().min(1), lease: runLeaseSchema, budget: runUntilBlockedBudgetSchema,
  resumeEvent: authenticatedResumeEventSchema.optional(),
}).strict();
export interface RunDriver {
  start(request: z.infer<typeof runDriverPumpRequestSchema>): Promise<z.infer<typeof workflowVNextRunStateSchema>>;
  resume(request: z.infer<typeof runDriverPumpRequestSchema>): Promise<z.infer<typeof workflowVNextRunStateSchema>>;
  runUntilBlocked(request: z.infer<typeof runDriverPumpRequestSchema>): Promise<z.infer<typeof workflowVNextRunStateSchema>>;
  cancel(workflowRunId: string, lease: z.infer<typeof runLeaseSchema>): z.infer<typeof workflowVNextRunStateSchema>;
}
export const INITIAL_DELAYED_RETRY_SUPPORT = "excluded_until_queue_or_scheduled_wakeup_conformance" as const;

export const workflowOrganizerPatchSchema = z.object({
  expectedDraftRevision: z.number().int().nonnegative(),
  edits: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("parameter_edit"), path: z.string().regex(/^parameters\.[a-zA-Z0-9_.-]+$/), value: jsonValueSchema }).strict(),
    z.object({ kind: z.literal("safe_patch"), path: z.string().regex(/^nodes\.[a-zA-Z0-9_-]+\.config\.[a-zA-Z0-9_.-]+$/), value: jsonValueSchema }).strict(),
  ])).min(1),
}).strict().superRefine((patch, ctx) => {
  const forbidden = new Set(["__proto__", "prototype", "constructor"]);
  patch.edits.forEach((edit, index) => {
    if (edit.path.split(".").some((segment) => forbidden.has(segment))) ctx.addIssue({ code: "custom", path: ["edits", index, "path"], message: "Unsafe organizer patch path" });
  });
});

const canonicalEventBase = {
  eventId: z.string().min(1), schemaVersion: z.literal(WORKFLOW_EVENT_SCHEMA_VERSION), eventVersion: z.literal(1),
  workflowRunId: z.string().min(1), sequence: z.number().int().positive(), revision: z.number().int().positive(),
  actor: z.object({ kind: z.enum(["user", "system", "worker"]), id: z.string().min(1) }).strict(),
  subject: z.object({ kind: z.enum(["run", "node", "waitpoint", "effect"]), id: z.string().min(1) }).strict(),
  causationId: z.string().min(1), correlationIds: z.array(z.string().min(1)).min(1), timestamp: z.string().datetime(),
} as const;
export const canonicalWorkflowEventSchema = z.discriminatedUnion("eventType", [
  z.object({ ...canonicalEventBase, eventType: z.literal("run_started"), payload: z.object({ source: workflowRunSourceSchema }).strict() }).strict(),
  z.object({ ...canonicalEventBase, eventType: z.literal("node_completed"), payload: z.object({ nodeId: z.string().min(1), outputRef: workflowEventOutputRefSchema }).strict() }).strict(),
  z.object({ ...canonicalEventBase, eventType: z.literal("wait_created"), payload: z.object({ waitpoint: workflowWaitpointSchema }).strict() }).strict(),
  z.object({ ...canonicalEventBase, eventType: z.literal("effect_claim_changed"), payload: z.object({ claimId: z.string().min(1), logicalEffectId: z.string().min(1), status: effectClaimStatusSchema }).strict() }).strict(),
  z.object({ ...canonicalEventBase, eventType: z.literal("run_status_changed"), payload: z.object({ status: z.enum(["ready", "running", "waiting", "succeeded", "failed", "cancelled"]), compatibilityPhase: z.string().min(1) }).strict() }).strict(),
]).superRefine((event, ctx) => {
  const expectedSubject = event.eventType === "node_completed"
    ? { kind: "node", id: event.payload.nodeId }
    : event.eventType === "wait_created"
      ? { kind: "waitpoint", id: event.payload.waitpoint.waitpointId }
      : event.eventType === "effect_claim_changed"
        ? { kind: "effect", id: event.payload.logicalEffectId }
        : { kind: "run", id: event.workflowRunId };
  if (event.subject.kind !== expectedSubject.kind || event.subject.id !== expectedSubject.id) ctx.addIssue({ code: "custom", path: ["subject"], message: "Event subject must match its redacted payload reference" });
});
export type CanonicalWorkflowEvent = z.infer<typeof canonicalWorkflowEventSchema>;
export type CanonicalWorkflowEventUpcaster = (value: Readonly<Record<string, unknown>>) => unknown;
export type CanonicalWorkflowEventUpcasters = Readonly<Record<string, CanonicalWorkflowEventUpcaster>>;

export function parseCanonicalWorkflowEvent(value: unknown, upcasters: CanonicalWorkflowEventUpcasters = {}): CanonicalWorkflowEvent {
  if (!value || typeof value !== "object") throw new Error("unsupported_workflow_event_version");
  const record = value as Readonly<Record<string, unknown>>;
  if (record.schemaVersion === WORKFLOW_EVENT_SCHEMA_VERSION && record.eventVersion === 1) return canonicalWorkflowEventSchema.parse(record);
  const upcaster = upcasters[`${String(record.schemaVersion)}@${String(record.eventVersion)}`];
  if (!upcaster) throw new Error("unsupported_workflow_event_version");
  return canonicalWorkflowEventSchema.parse(upcaster(record));
}

export function replayCanonicalWorkflowEvents(initial: z.infer<typeof workflowVNextRunStateSchema>, values: readonly unknown[], upcasters: CanonicalWorkflowEventUpcasters = {}): z.infer<typeof workflowVNextRunStateSchema> {
  let state = workflowVNextRunStateSchema.parse(initial);
  for (const value of values) {
    const event = parseCanonicalWorkflowEvent(value, upcasters);
    if (event.workflowRunId !== state.workflowRunId || event.sequence !== state.eventSequence + 1 || event.revision !== state.revision + 1) throw new Error("invalid_workflow_event_order");
    if (event.eventType === "run_started") state = { ...state, source: event.payload.source, status: "running" };
    else if (event.eventType === "node_completed") state = { ...state, selectedPath: state.selectedPath.includes(event.payload.nodeId) ? state.selectedPath : [...state.selectedPath, event.payload.nodeId], schedulerFrontier: state.schedulerFrontier.filter((nodeId) => nodeId !== event.payload.nodeId), outputRefs: { ...state.outputRefs, [event.payload.nodeId]: event.payload.outputRef } };
    else if (event.eventType === "wait_created") state = { ...state, waits: [...state.waits, event.payload.waitpoint], status: "waiting" };
    else if (event.eventType === "run_status_changed") state = { ...state, status: event.payload.status, compatibilityPhase: event.payload.compatibilityPhase };
    state = { ...state, revision: event.revision, eventSequence: event.sequence };
  }
  return workflowVNextRunStateSchema.parse(state);
}

export const WORKFLOW_ACTIONS = ["view", "edit_draft", "publish", "start", "approve_commit", "inspect_org_history"] as const;
export const workflowActionSchema = z.enum(WORKFLOW_ACTIONS);
export const WORKFLOW_ACTION_MATRIX = {
  viewer: ["view"], editor: ["view", "edit_draft"], publisher: ["view", "edit_draft", "publish"],
  operator: ["view", "start"], approver: ["view", "approve_commit"], auditor: ["view", "inspect_org_history"],
} as const satisfies Record<string, readonly z.infer<typeof workflowActionSchema>[]>;

export const CAPABILITY_READINESS_REASON_ORDER = [
  "not_registered", "not_implemented", "not_authorable", "definition_incompatible", "not_mounted", "missing_context",
  "missing_host_grant", "kill_switched", "version_not_pinned", "preview_required", "approval_required",
] as const;
export const capabilityReadinessReasonSchema = z.enum(CAPABILITY_READINESS_REASON_ORDER);
export const capabilityReadinessSchema = z.object({
  capabilityId: z.string().min(1), effectMode: z.enum(["read", "preview", "write"]), registered: z.boolean(), implemented: z.boolean(), authorable: z.boolean(),
  definitionCompatible: z.boolean(), mounted: z.boolean(), contextReady: z.boolean(), grantReady: z.boolean(),
  previewable: z.boolean(), committable: z.boolean(), killSwitched: z.boolean(), versionPinned: z.boolean(), callable: z.boolean(),
  reasonCodes: z.array(capabilityReadinessReasonSchema), nextAction: z.string().min(1).nullable(),
}).strict();
export type CapabilityReadiness = z.infer<typeof capabilityReadinessSchema>;

export function computeCapabilityReadiness(input: Omit<CapabilityReadiness, "effectMode" | "registered" | "implemented" | "callable" | "reasonCodes" | "nextAction"> & {
  registry?: CapabilityRegistry;
  implementedCapabilityIds?: readonly string[];
  approvalGranted?: boolean;
}): CapabilityReadiness {
  const descriptor = input.registry ? findCapability(input.registry, input.capabilityId) : undefined;
  const registered = descriptor?.status === "active";
  const implemented = registered && new Set(input.implementedCapabilityIds ?? []).has(input.capabilityId);
  const effectMode = descriptor?.effect === "none" || descriptor?.effect === "read" ? "read" : "write";
  const reasons = new Set<z.infer<typeof capabilityReadinessReasonSchema>>();
  if (!registered) reasons.add("not_registered");
  if (!implemented) reasons.add("not_implemented");
  if (!input.authorable) reasons.add("not_authorable");
  if (!input.definitionCompatible) reasons.add("definition_incompatible");
  if (!input.mounted) reasons.add("not_mounted");
  if (!input.contextReady) reasons.add("missing_context");
  if (!input.grantReady) reasons.add("missing_host_grant");
  if (input.killSwitched) reasons.add("kill_switched");
  if (!input.versionPinned) reasons.add("version_not_pinned");
  if (effectMode !== "read" && !input.previewable) reasons.add("preview_required");
  if (effectMode === "write" && input.previewable && (!input.committable || !input.approvalGranted)) reasons.add("approval_required");
  const reasonCodes = CAPABILITY_READINESS_REASON_ORDER.filter((reason) => reasons.has(reason));
  const callable = reasonCodes.length === 0;
  const { approvalGranted: _approvalGranted, registry: _registry, implementedCapabilityIds: _implementedCapabilityIds, ...readiness } = input;
  return capabilityReadinessSchema.parse({ ...readiness, effectMode, registered, implemented, callable, reasonCodes, nextAction: callable ? null : reasonCodes[0] });
}

export const legacyWorkflowVNextBridgeSchema = z.object({
  sourceSchema: z.literal("sonik.marketplace.workflow.v1"),
  targetSchema: z.literal(WORKFLOW_VNEXT_SCHEMA_VERSION),
  legacyDefinition: workflowDefinitionSchema,
  requiresCanonicalUpgrade: z.literal(true),
}).strict();

export function bridgeLegacyWorkflowDefinitionToVNext(input: WorkflowDefinition): z.infer<typeof legacyWorkflowVNextBridgeSchema> {
  return legacyWorkflowVNextBridgeSchema.parse({
    sourceSchema: "sonik.marketplace.workflow.v1",
    targetSchema: WORKFLOW_VNEXT_SCHEMA_VERSION,
    legacyDefinition: input,
    requiresCanonicalUpgrade: true,
  });
}

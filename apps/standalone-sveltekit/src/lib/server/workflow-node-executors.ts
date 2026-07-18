import { createHash } from "node:crypto";
import { z } from "zod";
import {
  authenticatedResumeEventSchema,
  boundedNodeOutputSchema,
  jsonValueSchema,
  parseEngineRequestForRegistry,
  parseEngineResponseForRegistry,
  reasoningExecutionContractSchema,
  workflowBindingSchema,
  workflowSchemaRefKey,
  workflowWaitpointSchema,
  type EngineRequest,
  type EngineResponse,
  type BoundedNodeOutput,
  type ExternalEffectIdentity,
  type JsonValue,
  type WorkflowEventOutputRef,
  type WorkflowNodeDescriptor,
  type WorkflowRuntimeRegistry,
  type WorkflowVNextNodeType,
} from "@sonik-agent-ui/tool-contracts/workflow-vnext";

const SCHEMA_DIGEST = `sha256:${"0".repeat(64)}`;
const SUPPORTED_NODE_TYPES = [
  "trigger", "ask_user", "skill", "reasoning", "artifact", "evidence",
  "tool_preview", "approval", "tool_commit", "branch",
] as const satisfies readonly WorkflowVNextNodeType[];

const schemaRef = (nodeType: string, kind: "config" | "input" | "output") => ({
  schemaId: `sonik.workflow.${nodeType}.${kind}`,
  version: 1,
  digest: SCHEMA_DIGEST,
});

export const workflowNodeExecutorDescriptors: readonly WorkflowNodeDescriptor[] = SUPPORTED_NODE_TYPES.map((nodeType) => ({
  nodeType,
  typeVersion: 1,
  configSchema: schemaRef(nodeType, "config"),
  inputSchema: schemaRef(nodeType, "input"),
  outputSchema: schemaRef(nodeType, "output"),
  effect: nodeType === "tool_commit" ? "write" : nodeType === "tool_preview" ? "read" : "none",
}));

export const workflowNodeExecutorRuntimeRegistry: WorkflowRuntimeRegistry = {
  descriptors: workflowNodeExecutorDescriptors,
  schemas: new Map(workflowNodeExecutorDescriptors.flatMap((descriptor) => [
    [workflowSchemaRefKey(descriptor.configSchema), z.record(z.string(), jsonValueSchema)],
    [workflowSchemaRefKey(descriptor.inputSchema), jsonValueSchema],
    [workflowSchemaRefKey(descriptor.outputSchema), jsonValueSchema],
  ])),
};

export type WorkflowNodeExecutor = (request: EngineRequest) => Promise<EngineResponse> | EngineResponse;

export interface WorkflowNodeAttemptEvent {
  phase: "started" | "finished";
  workflowRunId: string;
  workflowVersionId: string;
  nodeId: string;
  nodeType: WorkflowVNextNodeType;
  typeVersion: number;
  attempt: number;
  attemptId: string;
  correlationId: string;
  status?: EngineResponse["status"];
}

export interface WorkflowNodeExecutionContext {
  subjectId?: string;
  commandId?: string;
  answer?: JsonValue;
  approvalDecision?: "approved" | "rejected";
  reasoning?: unknown;
  reasoningUsage?: { steps: number; tokens: number };
  externalEffectIdentity?: Pick<ExternalEffectIdentity, "namespace" | "keyDigest">;
  inlineOutputByteLimit?: number;
  now?: () => number;
  runtimeRegistry?: WorkflowRuntimeRegistry;
  executors?: Partial<Record<WorkflowVNextNodeType, WorkflowNodeExecutor>>;
  onAttempt?: (event: WorkflowNodeAttemptEvent) => void;
}

export interface WorkflowBindingResolutionContext {
  organizationId?: string;
  runInput: JsonValue;
  hostContext: Readonly<Record<string, JsonValue>>;
  authorizedHostContextKeys: ReadonlySet<string>;
  nodeOutputs: Readonly<Record<string, unknown>>;
  nodeOutputSchemas: ReadonlyMap<string, z.ZodType>;
  loadArtifact?: (artifact: Extract<BoundedNodeOutput, { storage: "artifact" }>["artifact"]) => Promise<unknown>;
}

function readJsonPath(value: unknown, path: readonly string[]): JsonValue {
  let current = value;
  for (const segment of path) {
    if (segment === "__proto__" || segment === "prototype" || segment === "constructor") throw new Error("invalid_binding_path");
    if (!current || typeof current !== "object" || !(segment in current)) throw new Error("binding_path_missing");
    current = (current as Record<string, unknown>)[segment];
  }
  return jsonValueSchema.parse(current);
}

export async function resolveWorkflowBinding(bindingInput: unknown, context: WorkflowBindingResolutionContext): Promise<JsonValue> {
  const binding = workflowBindingSchema.parse(bindingInput);
  if (binding.source === "constant") return binding.value;
  if (binding.source === "run_input") return readJsonPath(context.runInput, binding.path);
  if (binding.source === "host_context") {
    if (!context.authorizedHostContextKeys.has(binding.key)) throw new Error("unauthorized_host_context");
    if (!(binding.key in context.hostContext)) throw new Error("host_context_missing");
    return context.hostContext[binding.key]!;
  }

  const output = boundedNodeOutputSchema.parse(context.nodeOutputs[binding.nodeId]);
  const schema = context.nodeOutputSchemas.get(binding.nodeId);
  if (!schema) throw new Error("node_output_schema_missing");
  const value = output.storage === "inline" ? output.value : await (async () => {
    if (context.organizationId && output.artifact.organizationId !== context.organizationId) throw new Error("artifact_organization_mismatch");
    if (!context.loadArtifact) throw new Error("artifact_loader_missing");
    return context.loadArtifact(output.artifact);
  })();
  return readJsonPath(schema.parse(value), binding.path);
}

export function validateWorkflowResumePayload(waitpointInput: unknown, eventInput: unknown, now = Date.now()): JsonValue {
  const waitpoint = workflowWaitpointSchema.parse(waitpointInput);
  const event = authenticatedResumeEventSchema.parse(eventInput);
  if (waitpoint.kind === "budget_yield" || waitpoint.kind !== event.kind
    || waitpoint.waitpointId !== event.waitpointId || waitpoint.runId !== event.workflowRunId
    || waitpoint.nodeId !== event.nodeId || waitpoint.subjectId !== event.subjectId) throw new Error("resume_payload_mismatch");
  if (waitpoint.expiresAt && (Date.parse(waitpoint.expiresAt) < now || Date.parse(event.issuedAt) > Date.parse(waitpoint.expiresAt))) throw new Error("resume_payload_expired");
  if (event.kind === "approval") {
    if (waitpoint.kind !== "approval" || waitpoint.logicalEffectId !== event.logicalEffectId) throw new Error("resume_payload_mismatch");
    return { approved: true };
  }
  return event.answer;
}

function inline(value: JsonValue): EngineResponse {
  return {
    status: "succeeded",
    output: {
      storage: "inline",
      value,
      byteLength: new TextEncoder().encode(JSON.stringify(value)).byteLength,
    },
  };
}

function terminal(code: string, message: string, outputRef?: WorkflowEventOutputRef): EngineResponse {
  return { status: "terminal_error", error: { code, message, retrySafe: false }, ...(outputRef ? { outputRef } : {}) };
}

export function toWorkflowOutputRef(output: BoundedNodeOutput, redactedSummary = "Node output recorded"): WorkflowEventOutputRef {
  return output.storage === "artifact" ? output : {
    storage: "inline_redacted",
    digest: `sha256:${createHash("sha256").update(JSON.stringify(output)).digest("hex")}`,
    byteLength: output.byteLength,
    redactedSummary,
  };
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function hashWorkflowInput(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function defaultExecutor(request: EngineRequest, context: WorkflowNodeExecutionContext): EngineResponse {
  switch (request.nodeType) {
    case "ask_user":
      return context.answer === undefined
        ? { status: "waiting", waitpoint: { kind: "answer", waitpointId: request.attemptId, runId: request.workflowRunId, nodeId: request.nodeId, subjectId: context.subjectId ?? "unknown" } }
        : inline(context.answer);
    case "approval":
      if (context.approvalDecision === "rejected") return terminal("approval_rejected", "The approval was rejected");
      return context.approvalDecision === "approved"
        ? inline({ approved: true })
        : { status: "waiting", waitpoint: { kind: "approval", waitpointId: request.attemptId, runId: request.workflowRunId, nodeId: request.nodeId, subjectId: context.subjectId ?? "unknown", logicalEffectId: request.logicalEffectId ?? request.nodeId, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() } };
    case "reasoning": {
      const contract = reasoningExecutionContractSchema.safeParse(context.reasoning);
      if (!contract.success) return terminal("reasoning_contract_required", "Reasoning requires structured output and execution budgets");
      if (contract.data.nestedCapabilityEffects.some((effect) => effect !== "none" && effect !== "read")) {
        return terminal("nested_governed_write_forbidden", "Reasoning nodes cannot receive governed write tools");
      }
      return inline(request.input);
    }
    case "tool_preview": {
      const stableInputHash = hashWorkflowInput(request.input);
      return inline({ commandId: context.commandId ?? "unbound", stableInputHash, effect: "read", approvalRequired: false, ...(request.externalEffectIdentity ? { externalEffectIdentity: request.externalEffectIdentity } : {}) });
    }
    case "tool_commit":
      return terminal("executor_unavailable", "No governed commit executor is mounted for this node");
    case "remote_execution":
    case "creative":
    case "promotion":
      return terminal("node_not_publishable", `${request.nodeType} is not publishable`);
    default:
      return inline(request.input);
  }
}

export async function dispatchWorkflowNode(
  requestInput: unknown,
  context: WorkflowNodeExecutionContext = {},
): Promise<EngineResponse> {
  const runtimeRegistry = context.runtimeRegistry ?? workflowNodeExecutorRuntimeRegistry;
  const request = parseEngineRequestForRegistry(requestInput, runtimeRegistry);
  context.onAttempt?.({
    phase: "started",
    workflowRunId: request.workflowRunId,
    workflowVersionId: request.workflowVersionId,
    nodeId: request.nodeId,
    nodeType: request.nodeType,
    typeVersion: request.typeVersion,
    attempt: request.attempt,
    attemptId: request.attemptId,
    correlationId: request.attemptId,
  });
  const executor = context.executors?.[request.nodeType];
  const reasoningContract = request.nodeType === "reasoning" ? reasoningExecutionContractSchema.safeParse(context.reasoning) : null;
  const startedAt = (context.now ?? Date.now)();
  let response = parseEngineResponseForRegistry(
    request,
    reasoningContract && !reasoningContract.success
      ? terminal("reasoning_contract_required", "Reasoning requires structured output and execution budgets with no governed nested writes")
      : executor ? await executor(request) : defaultExecutor(request, context),
    runtimeRegistry,
  );
  if (reasoningContract?.success && response.status === "succeeded") {
    if (response.output.storage === "inline") {
      const key = workflowSchemaRefKey(reasoningContract.data.structuredOutputSchema);
      const schema = "get" in runtimeRegistry.schemas && typeof runtimeRegistry.schemas.get === "function"
        ? runtimeRegistry.schemas.get(key)
        : (runtimeRegistry.schemas as Readonly<Record<string, z.ZodType>>)[key];
      if (!schema) response = terminal("reasoning_output_schema_missing", `Reasoning output schema is not registered: ${key}`);
      else if (!schema.safeParse(response.output.value).success) response = terminal("reasoning_output_schema_invalid", "Reasoning output does not match its declared structured schema");
    }
    if (executor && !context.reasoningUsage) response = terminal("reasoning_usage_required", "Reasoning adapters must report step and token usage");
    const usage = context.reasoningUsage ?? { steps: 1, tokens: 0 };
    const elapsed = (context.now ?? Date.now)() - startedAt;
    const inlineBytes = response.status === "succeeded" && response.output.storage === "inline" ? new TextEncoder().encode(JSON.stringify(response.output.value)).byteLength : 0;
    const outputRef = response.status === "succeeded" ? toWorkflowOutputRef(response.output, "Reasoning output withheld at budget yield") : undefined;
    if (usage.steps > reasoningContract.data.budgets.maxSteps || usage.tokens > reasoningContract.data.budgets.maxTokens || elapsed > reasoningContract.data.budgets.maxWallTimeMs) {
      response = terminal("reasoning_budget_exhausted", "Reasoning exceeded its step, token, or wall-time budget", outputRef);
    }
    if (response.status === "succeeded" && response.output.storage === "inline" && context.inlineOutputByteLimit === undefined) {
      response = terminal("reasoning_output_budget_required", "Reasoning requires an inline output byte budget");
    } else if (response.status === "succeeded" && inlineBytes > context.inlineOutputByteLimit!) {
      response = terminal("reasoning_output_budget_exhausted", "Reasoning output exceeded its inline byte budget", outputRef);
    }
  }
  context.onAttempt?.({
    phase: "finished",
    workflowRunId: request.workflowRunId,
    workflowVersionId: request.workflowVersionId,
    nodeId: request.nodeId,
    nodeType: request.nodeType,
    typeVersion: request.typeVersion,
    attempt: request.attempt,
    attemptId: request.attemptId,
    correlationId: request.attemptId,
    status: response.status,
  });
  return response;
}

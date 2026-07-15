import { createHash } from "node:crypto";
import { z } from "zod";
import {
  jsonValueSchema,
  parseEngineRequestForRegistry,
  parseEngineResponseForRegistry,
  reasoningExecutionContractSchema,
  workflowSchemaRefKey,
  type EngineRequest,
  type EngineResponse,
  type JsonValue,
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
  executors?: Partial<Record<WorkflowVNextNodeType, WorkflowNodeExecutor>>;
  onAttempt?: (event: WorkflowNodeAttemptEvent) => void;
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

function terminal(code: string, message: string): EngineResponse {
  return { status: "terminal_error", error: { code, message, retrySafe: false } };
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
      const stableInputHash = `sha256:${createHash("sha256").update(JSON.stringify(request.input)).digest("hex")}`;
      return inline({ commandId: context.commandId ?? "unbound", stableInputHash, effect: "read", approvalRequired: false });
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
  const request = parseEngineRequestForRegistry(requestInput, workflowNodeExecutorRuntimeRegistry);
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
  const response = parseEngineResponseForRegistry(
    request,
    reasoningContract && !reasoningContract.success
      ? terminal("reasoning_contract_required", "Reasoning requires structured output and execution budgets with no governed nested writes")
      : executor ? await executor(request) : defaultExecutor(request, context),
    workflowNodeExecutorRuntimeRegistry,
  );
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

// P1 #5 (production-readiness-agent-creation-2026-07-13.md): the workflow controller + run-state
// reducer's FIRST PRODUCTION CALLER. Plain module (no $env/$app imports, matching the
// reservation-commit.ts precedent) so tests can source-import it directly without a SvelteKit
// runtime; apps/standalone-sveltekit/src/routes/api/workflow-runs/+server.ts is a thin wrapper.
//
// Lifecycle: start -> preview (tool_preview node) -> approve (host-signed EVENT) -> commit
// (tool_commit node). runWorkflowNode is NEVER called on trigger/ask_user/approval nodes -- those
// are structural, driven by applyWorkflowRunEvent directly (request_approval/approve) or already
// active from run start.
//
// Normal builder workflows dispatch by nodeType@typeVersion through workflow-node-executors.ts.
// The reviewed Amplify demo remains an explicit internal override; workflow IDs are not the normal
// execution switch and unknown builder workflow IDs need no server registration.

import { randomUUID } from "node:crypto";
import {
  runWorkflowNode,
  startControllerRun,
  type WorkflowControllerCallbacks,
} from "@sonik-agent-ui/tool-contracts/workflow-controller";
import { applyWorkflowRunEvent, type WorkflowRunCommandPreview, type WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";
import { workflowDefinitionSchema, type WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
import { amplifyCampaignWorkflowManifest } from "@sonik-agent-ui/tool-contracts/marketplace-fixtures";
import { workflowEffectIdempotencyKey, type EngineResponse, type JsonValue, type WorkflowVNextNodeType } from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import { validateDraftedWorkflow } from "../agent-workflows/drafting-agent.ts";
import {
  assembleAmplifyCampaignContent,
  commitAmplifyCampaignArtifact,
  type AmplifyCampaignBrief,
} from "../agent-workflows/amplify-campaign-workflow.ts";
import { createKnowledgeStore, defaultKnowledgeRoot, type KnowledgeStore } from "../knowledge/knowledge-store.ts";
import { approvedCommandIdsFromHostSession } from "./host-command-runtime.ts";
import {
  dispatchWorkflowNode,
  type WorkflowNodeAttemptEvent,
  type WorkflowNodeExecutor,
} from "./workflow-node-executors.ts";
import type { WorkflowRunDriver } from "./workflow-run-driver.ts";
import { workflowRunStore, wrapWorkflowRunStoreAsync, type AsyncWorkflowRunStore, type WorkflowRunOwner, type WorkflowRunRow } from "./workflow-run-store.ts";

const AMPLIFY_CAMPAIGN_KNOWLEDGE_STORE_ID = "sonik.knowledge.campaign-artifacts";

export type WorkflowRunsAction =
  | { action: "start"; runId?: string; workflowId: string; workflow?: unknown; brief?: AmplifyCampaignBrief; artifactId?: string | null }
  | { action: "preview"; runId: string; nodeId: string }
  | { action: "approve"; runId: string; nodeId: string }
  | { action: "commit"; runId: string; nodeId: string }
  | { action: "run_until_blocked"; request: unknown }
  | { action: "resume_run"; request: unknown }
  | { action: "cancel_run"; runId: string; lease: unknown };

export type WorkflowRunsResult =
  | { ok: true; run: WorkflowRunState }
  | { ok: false; reason: string; run?: WorkflowRunState };

export interface WorkflowRunsDeps {
  hostSession: HostSessionEnvelope | null;
  /** Defaults to the in-memory singleton (async-wrapped); +server.ts passes resolveWorkflowRunStore(env)
   *  so a configured DATABASE_URL/SONIK_AGENT_UI_DATABASE_URL makes this durable with no caller change. */
  store?: AsyncWorkflowRunStore;
  knowledgeStore?: KnowledgeStore;
  /** P0 #1: platform.env on Cloudflare (secrets aren't on process.env there) --
   *  threaded into createKnowledgeStore so the campaign commit path's
   *  writeArtifactFile actually durably persists on Workers. Ignored when
   *  knowledgeStore is passed directly (tests/callers that override it). */
  env?: Record<string, unknown> | null;
  /** Optional package/runtime executors. The registry still owns validation and descriptor dispatch. */
  nodeExecutors?: Partial<Record<WorkflowVNextNodeType, WorkflowNodeExecutor>>;
  onNodeAttempt?: (event: WorkflowNodeAttemptEvent) => void;
  driver?: WorkflowRunDriver;
}

export function workflowRunOwnerFromHostSession(hostSession: HostSessionEnvelope | null): WorkflowRunOwner | null {
  const organizationId = hostSession?.organizationId?.trim();
  const userId = (hostSession?.userId ?? hostSession?.principalId)?.trim();
  if (!hostSession?.authenticated || !organizationId || !userId) return null;
  return {
    organizationId,
    userId,
    hostSessionId: typeof hostSession.sessionId === "string" && hostSession.sessionId.trim() ? hostSession.sessionId.trim() : null,
  };
}

/** Explicit internal workflows may override individual node executors. Builder workflows do not. */
interface RegisteredInternalWorkflow {
  definition: WorkflowDefinition;
  workflowVersionId: string;
  buildExecutors(input: unknown, knowledgeStore: KnowledgeStore): Record<string, WorkflowNodeExecutor>;
}

const registeredInternalWorkflows: Record<string, RegisteredInternalWorkflow> = {
  "amplify.campaign.create": {
    definition: amplifyCampaignWorkflowManifest.payload.workflow as WorkflowDefinition,
    workflowVersionId: amplifyCampaignWorkflowManifest.packageVersionId,
    buildExecutors(input, knowledgeStore) {
      const brief = input as AmplifyCampaignBrief;
      return {
        preview: () => {
          assembleAmplifyCampaignContent(brief);
          return inlineEngineResponse({ preview: { commandId: "amplify.campaign.create", stableInputHash: "campaign-hash", effect: "write", approvalRequired: true } });
        },
        commit: async () => {
          const content = assembleAmplifyCampaignContent(brief);
          const { receiptRef } = await commitAmplifyCampaignArtifact(knowledgeStore, AMPLIFY_CAMPAIGN_KNOWLEDGE_STORE_ID, content);
          return {
            ...inlineEngineResponse({ receiptRef }),
            receipt: { receiptId: receiptRef, semanticStatus: "success" },
          };
        },
      };
    },
  },
};

function isAmplifyCampaignBrief(value: unknown): value is AmplifyCampaignBrief {
  if (!value || typeof value !== "object") return false;
  const brief = value as Record<string, unknown>;
  return ["productName", "audience", "offer", "launchDate"].every((key) => typeof brief[key] === "string" && brief[key].trim().length > 0);
}

function nodeById(definition: WorkflowDefinition, nodeId: string) {
  return definition.nodes.find((node) => node.nodeId === nodeId);
}

// P3: `action.runId` on "start" is client-supplied (used to resume/pin a specific run id).
// The persistence key is scoped by organization + user; a collision for that owner throws a
// Postgres unique_violation, while another owner may safely use the same opaque client run id.
function isRunIdConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { code?: unknown }).code === "23505") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key/i.test(message);
}

export async function handleWorkflowRunsAction(action: WorkflowRunsAction, deps: WorkflowRunsDeps): Promise<WorkflowRunsResult> {
  const owner = workflowRunOwnerFromHostSession(deps.hostSession);
  if (!owner) return { ok: false, reason: "authenticated_workspace_owner_required" };
  if (action.action === "run_until_blocked" || action.action === "resume_run" || action.action === "cancel_run") {
    if (!deps.driver) return { ok: false, reason: "workflow_run_driver_unavailable" };
    if (action.action !== "cancel_run" && action.request && typeof action.request === "object" && "hostSigned" in action.request) return { ok: false, reason: "public_hostSigned_forbidden" };
    try {
      const run = action.action === "run_until_blocked"
        ? await deps.driver.runUntilBlocked(action.request)
        : action.action === "resume_run"
          ? await deps.driver.resume(action.request)
          : await deps.driver.cancel(action.runId, action.lease);
      return { ok: true, run: run as unknown as WorkflowRunState };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "workflow_run_driver_failed" };
    }
  }
  const store = deps.store ?? wrapWorkflowRunStoreAsync(workflowRunStore);

  if (action.action === "start") {
    const registered = registeredInternalWorkflows[action.workflowId];
    let definition: WorkflowDefinition;
    let workflowVersionId: string;
    let runInput: unknown = null;

    if (registered) {
      definition = registered.definition;
      workflowVersionId = registered.workflowVersionId;
      if (action.workflowId === "amplify.campaign.create") {
        if (!isAmplifyCampaignBrief(action.brief)) {
          return { ok: false, reason: "amplify_campaign_brief_required" };
        }
        runInput = action.brief;
      }
    } else if (action.workflow !== undefined) {
      const parsed = workflowDefinitionSchema.safeParse(action.workflow);
      if (!parsed.success) return { ok: false, reason: "invalid_workflow_definition" };
      const validated = validateDraftedWorkflow(parsed.data);
      if (!validated.ok) return { ok: false, reason: `unsupported_draft: ${validated.reasons.join(" | ")}` };
      definition = validated.workflow;
      // No published version for an in-flight draft -- version the run against its own workflowId,
      // matching how a never-published draft has no packageVersionId to pin to (D002 only applies
      // once something is actually published).
      workflowVersionId = `${definition.workflowId}@0.0.0-draft`;
    } else {
      return { ok: false, reason: "unknown_workflowId_or_workflow_required" };
    }

    const runId = action.runId ?? randomUUID();
    if (action.runId) {
      const existingRun = await store.getRun(owner, runId);
      if (existingRun) return { ok: false, reason: "run_id_conflict" };
    }
    const state = startControllerRun(definition, { runId, workflowVersionId, artifactId: action.artifactId ?? null });
    try {
      await store.createRun(owner, { workflowId: definition.workflowId, workflowVersionId, definition, input: runInput, state });
    } catch (error) {
      // Race past the getRun check above straight into the store's run_id primary key --
      // surface that as a clean conflict result too, not an unhandled 500.
      if (isRunIdConflictError(error)) return { ok: false, reason: "run_id_conflict" };
      throw error;
    }
    return { ok: true, run: state };
  }

  const row = await store.getRun(owner, action.runId);
  if (!row) return { ok: false, reason: "run_not_found" };

  if (action.action === "preview") {
    const node = nodeById(row.definition, action.nodeId);
    if (!node) return { ok: false, reason: "unknown_node", run: row.state };
    if (node.type !== "tool_preview") return { ok: false, reason: "node_is_not_tool_preview", run: row.state };
    const callbacks = resolveCallbacks(row, deps);
    const result = await runWorkflowNode(row.state, row.definition, action.nodeId, callbacks);
    const updated = (await store.updateRunState(owner, action.runId, result.state)) ?? row;
    return result.ok ? { ok: true, run: updated.state } : { ok: false, reason: result.reason, run: updated.state };
  }

  if (action.action === "approve") {
    const node = nodeById(row.definition, action.nodeId);
    if (!node) return { ok: false, reason: "unknown_node", run: row.state };
    if (node.type !== "tool_commit") return { ok: false, reason: "node_is_not_tool_commit", run: row.state };

    // Host-signed doctrine, enforced here rather than trusted from the request body: hostSigned is
    // derived ONLY from the resolved trusted host session (deps.hostSession), which the +server.ts
    // route resolves via createAgentHostSessionEnvelope -- the same seam /api/reservation/commit
    // already uses. Unauthenticated callers fail before the first persistence read at the handler
    // boundary, so they can neither discover a run nor reach this reducer/callback path.
    const hostSigned = Boolean(deps.hostSession?.authenticated && deps.hostSession.organizationId);
    const approvedCommandIds = hostSigned ? approvedCommandIdsFromHostSession(deps.hostSession) : [];

    const requested = applyWorkflowRunEvent(row.state, { type: "request_approval", nodeId: action.nodeId });
    if (!requested.ok) {
      await store.updateRunState(owner, action.runId, requested.state);
      return { ok: false, reason: requested.reason, run: requested.state };
    }
    const approved = applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned, approvedCommandIds });
    const updated = (await store.updateRunState(owner, action.runId, approved.state)) ?? row;
    return approved.ok ? { ok: true, run: updated.state } : { ok: false, reason: approved.reason, run: updated.state };
  }

  // action.action === "commit"
  const node = nodeById(row.definition, action.nodeId);
  if (!node) return { ok: false, reason: "unknown_node", run: row.state };
  if (node.type !== "tool_commit") return { ok: false, reason: "node_is_not_tool_commit", run: row.state };
  const callbacks = resolveCallbacks(row, deps);
  const result = await runWorkflowNode(row.state, row.definition, action.nodeId, callbacks);
  const updated = (await store.updateRunState(owner, action.runId, result.state)) ?? row;
  return result.ok ? { ok: true, run: updated.state } : { ok: false, reason: result.reason, run: updated.state };
}

function inlineEngineResponse(value: JsonValue): Extract<EngineResponse, { status: "succeeded" }> {
  return {
    status: "succeeded",
    output: { storage: "inline", value, byteLength: new TextEncoder().encode(JSON.stringify(value)).byteLength },
  };
}

function jsonInput(value: unknown): JsonValue {
  return value === undefined ? null : JSON.parse(JSON.stringify(value)) as JsonValue;
}

function resolveCallbacks(row: WorkflowRunRow, deps: WorkflowRunsDeps): WorkflowControllerCallbacks {
  const registered = registeredInternalWorkflows[row.workflowId];
  const knowledgeStore = registered
    ? deps.knowledgeStore ?? createKnowledgeStore(defaultKnowledgeRoot(), deps.env)
    : deps.knowledgeStore;
  const internalExecutors = registered && knowledgeStore ? registered.buildExecutors(row.input, knowledgeStore) : {};
  return Object.fromEntries(row.definition.nodes
    .filter((node) => node.type === "tool_preview" || node.type === "tool_commit")
    .map((node) => [node.nodeId, async () => {
      const logicalEffectId = node.type === "tool_commit" ? `${node.nodeId}:${node.commandId ?? "unbound"}` : undefined;
      const attemptId = `${row.runId}:${node.nodeId}:attempt:1`;
      const response = await dispatchWorkflowNode({
        workflowRunId: row.runId,
        workflowVersionId: row.workflowVersionId,
        nodeId: node.nodeId,
        nodeType: node.type,
        typeVersion: 1,
        attempt: 1,
        attemptId,
        logicalEffectId,
        input: jsonInput(row.input),
        contextSnapshot: { organizationId: row.organizationId, userId: row.userId },
        capabilityPins: row.definition.facadeToolIds,
        idempotencyKey: logicalEffectId ? workflowEffectIdempotencyKey(row.runId, logicalEffectId) : attemptId,
      }, {
        subjectId: row.userId,
        commandId: node.commandId,
        executors: {
          ...deps.nodeExecutors,
          ...(internalExecutors[node.nodeId] ? { [node.type]: internalExecutors[node.nodeId] } : {}),
        },
        onAttempt: deps.onNodeAttempt,
      });
      if (node.type === "tool_preview") {
        if (response.status !== "succeeded" || response.output.storage !== "inline") {
          const error = response.status === "retryable_error" || response.status === "terminal_error"
            ? response.error
            : { code: "executor_response_mismatch", message: "Preview executor did not return inline output" };
          return { kind: "preview", ok: false, error } as const;
        }
        const output = response.output.value as { preview?: unknown };
        return { kind: "preview", ok: true, preview: (output.preview ?? output) as WorkflowRunCommandPreview } as const;
      }
      if (response.status === "succeeded" && response.receipt) {
        const output = response.output.storage === "inline" ? response.output.value as { receiptRef?: string } : {};
        return { kind: "commit", ok: true, receiptRef: output.receiptRef ?? response.receipt.receiptId } as const;
      }
      const error = response.status === "retryable_error" || response.status === "terminal_error"
        ? response.error
        : { code: "semantic_receipt_required", message: "Commit executor did not return a semantic receipt" };
      return { kind: "commit", ok: false, error } as const;
    }]));
}

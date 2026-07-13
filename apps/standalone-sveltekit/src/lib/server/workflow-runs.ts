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
// Node-execution callbacks are an explicit registry, not a generic command dispatcher: this is the
// controller's first caller outside the reservation regression floor and the Amplify campaign wow
// demo, and only those two already have real, reviewed preview/commit implementations. Booking
// stays reads-only here by construction (fence: no real booking writes) -- the reservation write
// path keeps living solely at /api/reservation/commit, untouched. A workflowId with no registry
// entry (e.g. an arbitrary builder draft) still runs start/approve/commit lifecycle mechanics; its
// preview/commit calls surface the controller's own honest "no_callback_registered" rather than
// fabricating an execution.

import { randomUUID } from "node:crypto";
import {
  runWorkflowNode,
  startControllerRun,
  type WorkflowControllerCallbacks,
} from "@sonik-agent-ui/tool-contracts/workflow-controller";
import { applyWorkflowRunEvent, type WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";
import { workflowDefinitionSchema, type WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
import { amplifyCampaignWorkflowManifest } from "@sonik-agent-ui/tool-contracts/marketplace-fixtures";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import { validateDraftedWorkflow } from "../agent-workflows/drafting-agent.ts";
import {
  assembleAmplifyCampaignContent,
  commitAmplifyCampaignArtifact,
  type AmplifyCampaignBrief,
} from "../agent-workflows/amplify-campaign-workflow.ts";
import { createKnowledgeStore, defaultKnowledgeRoot, type KnowledgeStore } from "../knowledge/knowledge-store.ts";
import { approvedCommandIdsFromHostSession } from "./host-command-runtime.ts";
import { workflowRunStore, wrapWorkflowRunStoreAsync, type AsyncWorkflowRunStore } from "./workflow-run-store.ts";

const AMPLIFY_CAMPAIGN_KNOWLEDGE_STORE_ID = "sonik.knowledge.campaign-artifacts";

export type WorkflowRunsAction =
  | { action: "start"; runId?: string; workflowId: string; workflow?: unknown; brief?: AmplifyCampaignBrief; artifactId?: string | null }
  | { action: "preview"; runId: string; nodeId: string }
  | { action: "approve"; runId: string; nodeId: string }
  | { action: "commit"; runId: string; nodeId: string };

export type WorkflowRunsResult =
  | { ok: true; run: WorkflowRunState }
  | { ok: false; reason: string; run?: WorkflowRunState };

export interface WorkflowRunsDeps {
  hostSession: HostSessionEnvelope | null;
  /** Defaults to the in-memory singleton (async-wrapped); +server.ts passes resolveWorkflowRunStore(env)
   *  so a configured DATABASE_URL/SONIK_AGENT_UI_DATABASE_URL makes this durable with no caller change. */
  store?: AsyncWorkflowRunStore;
  knowledgeStore?: KnowledgeStore;
}

/** Registered node-callback factories, keyed by the workflow's own workflowId (not packageVersionId
 *  -- callbacks are the same across draft/published versions of one workflow). */
interface RegisteredWorkflow {
  definition: WorkflowDefinition;
  workflowVersionId: string;
  buildCallbacks(input: unknown, knowledgeStore: KnowledgeStore): WorkflowControllerCallbacks;
}

const registeredWorkflows: Record<string, RegisteredWorkflow> = {
  "amplify.campaign.create": {
    definition: amplifyCampaignWorkflowManifest.payload.workflow as WorkflowDefinition,
    workflowVersionId: amplifyCampaignWorkflowManifest.packageVersionId,
    buildCallbacks(input, knowledgeStore) {
      const brief = input as AmplifyCampaignBrief;
      return {
        preview: () => {
          assembleAmplifyCampaignContent(brief);
          return {
            kind: "preview",
            ok: true,
            preview: { commandId: "amplify.campaign.create", stableInputHash: "campaign-hash", effect: "write", approvalRequired: true },
          };
        },
        commit: async () => {
          const content = assembleAmplifyCampaignContent(brief);
          const { receiptRef } = await commitAmplifyCampaignArtifact(knowledgeStore, AMPLIFY_CAMPAIGN_KNOWLEDGE_STORE_ID, content);
          return { kind: "commit", ok: true, receiptRef };
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

export async function handleWorkflowRunsAction(action: WorkflowRunsAction, deps: WorkflowRunsDeps): Promise<WorkflowRunsResult> {
  const store = deps.store ?? wrapWorkflowRunStoreAsync(workflowRunStore);

  if (action.action === "start") {
    const registered = registeredWorkflows[action.workflowId];
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
      workflowVersionId = `${definition.workflowId}@draft`;
    } else {
      return { ok: false, reason: "unknown_workflowId_or_workflow_required" };
    }

    const runId = action.runId ?? randomUUID();
    const state = startControllerRun(definition, { runId, workflowVersionId, artifactId: action.artifactId ?? null });
    await store.createRun({ workflowId: definition.workflowId, workflowVersionId, definition, input: runInput, state });
    return { ok: true, run: state };
  }

  const row = await store.getRun(action.runId);
  if (!row) return { ok: false, reason: "run_not_found" };

  if (action.action === "preview") {
    const node = nodeById(row.definition, action.nodeId);
    if (!node) return { ok: false, reason: "unknown_node", run: row.state };
    if (node.type !== "tool_preview") return { ok: false, reason: "node_is_not_tool_preview", run: row.state };
    const callbacks = resolveCallbacks(row.workflowId, row.input, deps.knowledgeStore);
    const result = await runWorkflowNode(row.state, row.definition, action.nodeId, callbacks);
    const updated = (await store.updateRunState(action.runId, result.state)) ?? row;
    return result.ok ? { ok: true, run: updated.state } : { ok: false, reason: result.reason, run: updated.state };
  }

  if (action.action === "approve") {
    const node = nodeById(row.definition, action.nodeId);
    if (!node) return { ok: false, reason: "unknown_node", run: row.state };
    if (node.type !== "tool_commit") return { ok: false, reason: "node_is_not_tool_commit", run: row.state };

    // Host-signed doctrine, enforced here rather than trusted from the request body: hostSigned is
    // derived ONLY from the resolved trusted host session (deps.hostSession), which the +server.ts
    // route resolves via createAgentHostSessionEnvelope -- the same seam /api/reservation/commit
    // already uses. An unauthenticated caller (deps.hostSession === null) still reaches the
    // reducer's own model_supplied_approval_is_not_trusted refusal instead of a bespoke 401, keeping
    // the "chat text / model output is never approval" check in exactly one place.
    const hostSigned = Boolean(deps.hostSession?.authenticated && deps.hostSession.organizationId);
    const approvedCommandIds = hostSigned ? approvedCommandIdsFromHostSession(deps.hostSession) : [];

    const requested = applyWorkflowRunEvent(row.state, { type: "request_approval", nodeId: action.nodeId });
    if (!requested.ok) {
      await store.updateRunState(action.runId, requested.state);
      return { ok: false, reason: requested.reason, run: requested.state };
    }
    const approved = applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned, approvedCommandIds });
    const updated = (await store.updateRunState(action.runId, approved.state)) ?? row;
    return approved.ok ? { ok: true, run: updated.state } : { ok: false, reason: approved.reason, run: updated.state };
  }

  // action.action === "commit"
  const node = nodeById(row.definition, action.nodeId);
  if (!node) return { ok: false, reason: "unknown_node", run: row.state };
  if (node.type !== "tool_commit") return { ok: false, reason: "node_is_not_tool_commit", run: row.state };
  const callbacks = resolveCallbacks(row.workflowId, row.input, deps.knowledgeStore);
  const result = await runWorkflowNode(row.state, row.definition, action.nodeId, callbacks);
  const updated = (await store.updateRunState(action.runId, result.state)) ?? row;
  return result.ok ? { ok: true, run: updated.state } : { ok: false, reason: result.reason, run: updated.state };
}

function resolveCallbacks(workflowId: string, input: unknown, knowledgeStoreOverride?: KnowledgeStore): WorkflowControllerCallbacks {
  const registered = registeredWorkflows[workflowId];
  if (!registered) return {};
  const knowledgeStore = knowledgeStoreOverride ?? createKnowledgeStore(defaultKnowledgeRoot());
  return registered.buildCallbacks(input, knowledgeStore);
}

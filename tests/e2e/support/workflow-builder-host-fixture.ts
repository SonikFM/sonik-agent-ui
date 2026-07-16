import type { Page, Route } from "@playwright/test";

export const AMPLIFY_CAMPAIGN_COMMAND_ID = "amplify.campaign.create";

type RunPhase = "intake" | "preview_ready" | "approved" | "committed";
type SignedRequestKind = "agentModels" | "agentDefinitions" | "workflowDefinitions" | "workflowRuns";

export interface WorkflowBuilderHostFixtureObservation {
  signedHostContextHeaders: Record<SignedRequestKind, string[]>;
  sessionId: string;
  workflowDefinitionActions: string[];
  workflowRunActions: string[];
  workflowDefinitionBodies: Array<Record<string, unknown>>;
  workflowRunBodies: Array<Record<string, unknown>>;
  historyQueries: string[];
}

export interface WorkflowBuilderHostFixtureOptions {
  approvedCommandIds?: string[];
  previewPhase?: "preview_ready" | "approved";
  workflowRunDelayMs?: number;
  waitOnStart?: boolean;
}

const SESSION_ID = "workflow-builder-host-fixture-session";
const now = "2026-07-14T12:00:00.000Z";
const definitionDigest = `sha256:${"a".repeat(64)}`;
const workflowPublishPins = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  workflowVersionId: "amplify.campaign.create@0.1.0",
  definitionDigest,
  agentPublishedVersionId: "agent@0.1.0",
  nodeDescriptorsDigest: `sha256:${"b".repeat(64)}`,
  capabilityVersionsDigest: `sha256:${"c".repeat(64)}`,
  toolPackVersionsDigest: `sha256:${"d".repeat(64)}`,
  skillVersionsDigest: `sha256:${"e".repeat(64)}`,
  runtimePolicyDigest: `sha256:${"f".repeat(64)}`,
};
const sessionSummary = {
  id: SESSION_ID,
  name: "Embedded campaign planning",
  mode: "chat",
  archived: false,
  is_important: false,
  folder: null,
  message_count: 0,
  active_document_id: null,
  active_artifact_id: null,
  created_at: now,
  updated_at: now,
  last_accessed: now,
  last_message_at: null,
};

function workflowRun(phase: RunPhase, waiting = false) {
  const approved = phase === "approved" || phase === "committed";
  return {
    runId: "workflow-builder-host-fixture-run",
    workflowId: AMPLIFY_CAMPAIGN_COMMAND_ID,
    workflowVersionId: "sonik.amplify.campaign.workflow@0.1.0",
    artifactId: phase === "committed" ? "campaign-fixture-artifact" : null,
    phase,
    currentNodeId: phase === "intake" ? "trigger" : phase === "preview_ready" ? "preview" : "commit",
    facadeToolIds: [AMPLIFY_CAMPAIGN_COMMAND_ID],
    nodeStates: {
      trigger: { nodeId: "trigger", type: "trigger", status: phase === "intake" ? "active" : "committed", effect: "none", required: false },
      brief: { nodeId: "brief", type: "ask_user", status: "committed", effect: "none", required: false },
      preview: {
        nodeId: "preview",
        type: "tool_preview",
        status: phase === "intake" ? "pending" : "preview_ready",
        commandId: AMPLIFY_CAMPAIGN_COMMAND_ID,
        effect: "none",
        required: false,
        ...(phase === "intake" ? {} : {
          preview: { commandId: AMPLIFY_CAMPAIGN_COMMAND_ID, stableInputHash: "campaign-hash", effect: "write", approvalRequired: true },
        }),
      },
      confirm: { nodeId: "confirm", type: "approval", status: approved ? "approved" : "pending", effect: "none", required: false },
      commit: { nodeId: "commit", type: "tool_commit", status: phase === "committed" ? "committed" : approved ? "approved" : "pending", commandId: AMPLIFY_CAMPAIGN_COMMAND_ID, effect: "write", required: false },
    },
    approvalState: approved
      ? { status: "approved", hostSigned: true, approvedCommandIds: [AMPLIFY_CAMPAIGN_COMMAND_ID], approvedInputHashes: { [AMPLIFY_CAMPAIGN_COMMAND_ID]: "campaign-hash" } }
      : { status: "none", hostSigned: false, approvedCommandIds: [], approvedInputHashes: {} },
    receipts: phase === "committed"
      ? [{ nodeId: "commit", commandId: AMPLIFY_CAMPAIGN_COMMAND_ID, receiptRef: "campaign-fixture-receipt", semanticStatus: "success" }]
      : [],
    waits: waiting
      ? [{ waitpointId: "campaign-fixture-wait", nodeId: "brief", logicalEffectId: "campaign-fixture-brief" }]
      : [],
  };
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

/** Install only deterministic browser fixtures. By default the signed-context
 * allow-list contains exactly the one command exercised by this story; tests
 * may explicitly remove it to prove the fail-closed disabled-control copy. */
export async function installWorkflowBuilderHostFixture(
  page: Page,
  options: WorkflowBuilderHostFixtureOptions = {},
): Promise<WorkflowBuilderHostFixtureObservation> {
  const observation: WorkflowBuilderHostFixtureObservation = {
    signedHostContextHeaders: { agentModels: [], agentDefinitions: [], workflowDefinitions: [], workflowRuns: [] },
    sessionId: SESSION_ID,
    workflowDefinitionActions: [],
    workflowRunActions: [],
    workflowDefinitionBodies: [],
    workflowRunBodies: [],
    historyQueries: [],
  };
  let draftRevision = 0;
  let definition: Record<string, unknown> | undefined;
  let published = false;
  const recordSignedHeader = (kind: SignedRequestKind, route: Route) => {
    observation.signedHostContextHeaders[kind].push(route.request().headers()["x-sonik-agent-ui-host-context"] ?? "");
  };

  await page.route("**/api/agent-models", (route) => {
    recordSignedHeader("agentModels", route);
    return fulfillJson(route, { models: [], source: "fallback" });
  });
  await page.route("**/api/agent-definitions", (route) => {
    recordSignedHeader("agentDefinitions", route);
    return fulfillJson(route, { ok: true });
  });
  await page.route("**/api/workflow-definitions", (route) => {
    recordSignedHeader("workflowDefinitions", route);
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown> & { action?: string; definition?: Record<string, unknown> };
    observation.workflowDefinitionActions.push(body.action ?? "unknown");
    observation.workflowDefinitionBodies.push(body);
    if (body.action === "list") return fulfillJson(route, { ok: true, drafts: definition ? [{ organizationId: "11111111-1111-4111-8111-111111111111", workflowId: definition.workflowId, draftRevision, definitionDigest, definition }] : [] });
    if (body.action === "versions") return fulfillJson(route, { ok: true, versions: published ? [{ workflowVersionId: "amplify.campaign.create@0.1.0", sourceDraftRevision: draftRevision, publishedAt: now }] : [] });
    if (body.action === "get") return fulfillJson(route, { ok: true, draft: { organizationId: "11111111-1111-4111-8111-111111111111", workflowId: definition?.workflowId, draftRevision, definitionDigest, definition } });
    if (body.action === "publish") {
      published = true;
      return fulfillJson(route, { ok: true, version: { workflowVersionId: "amplify.campaign.create@0.1.0", sourceDraftRevision: draftRevision, definitionDigest, definition } });
    }
    if (body.definition) definition = body.definition;
    if (body.action === "create" || body.action === "update" || body.action === "organizer_patch") draftRevision += 1;
    if (body.action === "organizer_patch" && definition) {
      const edits = ((body.patch as { edits?: Array<{ path: string; value: unknown }> } | undefined)?.edits ?? []);
      const nodes = Array.isArray(definition.nodes) ? definition.nodes as Array<Record<string, unknown>> : [];
      definition = {
        ...definition,
        nodes: nodes.map((node) => {
          const edit = edits.find(({ path }) => path === `nodes.${node.nodeId}.config.title`);
          return edit ? { ...node, config: { ...((node.config as Record<string, unknown> | undefined) ?? {}), title: edit.value } } : node;
        }),
      };
    }
    return fulfillJson(route, {
      ok: true,
      draft: {
        organizationId: "11111111-1111-4111-8111-111111111111",
        workflowId: definition?.workflowId,
        draftRevision,
        definitionDigest,
        definition,
      },
    });
  });
  await page.route("**/api/workflow-runs", async (route) => {
    recordSignedHeader("workflowRuns", route);
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown> & { action?: string };
    observation.workflowRunActions.push(body.action ?? "unknown");
    observation.workflowRunBodies.push(body);
    if (options.workflowRunDelayMs) await new Promise((resolve) => setTimeout(resolve, options.workflowRunDelayMs));
    const phase: RunPhase = body.action === "preview"
      ? (options.previewPhase ?? "preview_ready")
      : body.action === "approve"
        ? "approved"
        : body.action === "commit"
          ? "committed"
          : "intake";
    await fulfillJson(route, { ok: true, run: workflowRun(phase, Boolean(options.waitOnStart && body.action === "start")) });
  });
  await page.route("**/api/workflow-history?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    observation.historyQueries.push(query.toString());
    return fulfillJson(route, {
      ok: true,
      history: {
        query: Object.fromEntries(query),
        conversations: [],
        workflows: [{ workflowRunId: "workflow-builder-host-fixture-run", workflowId: AMPLIFY_CAMPAIGN_COMMAND_ID, workflowVersionId: "amplify.campaign.create@0.1.0", sessionId: SESSION_ID, createdAt: now, updatedAt: now, status: "completed" }],
        nodes: [],
        toolCalls: [],
        approvals: [{ approvalId: "campaign-fixture-approval", workflowRunId: "workflow-builder-host-fixture-run", nodeId: "confirm", status: "approved" }],
        artifacts: [{ artifactId: "campaign-fixture-artifact", workflowRunId: "workflow-builder-host-fixture-run", nodeId: "commit", status: "ready" }],
        receipts: [{ receiptId: "campaign-fixture-receipt", workflowRunId: "workflow-builder-host-fixture-run", nodeId: "commit", status: "committed" }],
        events: [],
      },
    });
  });
  await page.route("**/api/session**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/sessions") {
      await fulfillJson(route, url.searchParams.get("archived") === "true" ? [] : [sessionSummary]);
      return;
    }
    if (url.pathname === "/api/session" && route.request().method() === "POST") {
      await fulfillJson(route, sessionSummary);
      return;
    }
    await fulfillJson(route, {
      session: sessionSummary,
      activeDocument: null,
      messages: [],
      runs: [],
      telemetry: [],
      reattach: null,
      activeArtifact: null,
      activeArtifactState: null,
      activeArtifactVersions: [],
    });
  });

  await page.waitForFunction(() => Boolean((window as Window & { __sonikAgentUI?: unknown }).__sonikAgentUI));
  await page.evaluate(({ approvedCommandIds, workflowPublishPins }) => {
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    window.postMessage({
      source: "sonik-agent-ui-host",
      type: "sonik:agent-ui:page-context",
      authority: {
        header: "workflow_builder_host_fixture_header",
        revision: Date.now(),
        expiresAt,
      },
      payload: {
        route: "/campaigns",
        surface: "campaign-workspace",
        authenticated: true,
        organizationId: "11111111-1111-4111-8111-111111111111",
        scopes: ["amplify:write"],
        hostSession: {
          source: "embedded-host",
          sessionId: "workflow-builder-host-fixture-session",
          userId: "workflow-builder-host-fixture-user",
          principalId: "workflow-builder-host-fixture-user",
          organizationId: "11111111-1111-4111-8111-111111111111",
          authenticated: true,
          scopes: ["amplify:write"],
          expiresAt,
          metadata: { approvedCommandIds, workflowPublishPins: Object.values(workflowPublishPins) },
        },
      },
    }, window.location.origin);
  }, { approvedCommandIds: options.approvedCommandIds ?? [AMPLIFY_CAMPAIGN_COMMAND_ID], workflowPublishPins });
  return observation;
}

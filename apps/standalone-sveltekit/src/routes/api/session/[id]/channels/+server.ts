import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import {
  getRequestWorkspaceSession,
  listRequestWorkspacePageContextSnapshots,
  recordRequestWorkspacePageContextSnapshot,
} from "$lib/server/workspace-request-store";
import {
  resolveSignedWorkspaceSessionId,
  resolveTrustedHostSessionSnapshot,
} from "$lib/server/workspace-services";
import {
  LOCAL_CHANNEL_ORGANIZATION_ID,
  LOCAL_CHANNEL_USER_ID,
  createChannelsProjection,
  createChannelsSnapshotRecordInput,
  createScopedFixtureTriggerBinding,
  mergeTriggerBindingIntoEnvelope,
  readLatestChannelsEnvelope,
  type ChannelsRequestScope,
  type ChannelsStateEnvelope,
} from "$lib/server/channels-state";
import type { RequestHandler } from "./$types";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  pragma: "no-cache",
  expires: "0",
};

const saveFixtureTriggerBindingBodySchema = z.strictObject({
  bindingId: z.string().optional(),
  channelId: z.string(),
  event: z.string(),
  workflowId: z.string(),
  sourcePath: z.string(),
  targetPath: z.string(),
});

const channelsSaveTails = new Map<string, Promise<void>>();

async function withChannelsSaveLock<T>(scope: ChannelsRequestScope, operation: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([scope.organizationId, scope.userId, scope.sessionId]);
  const previous = channelsSaveTails.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  channelsSaveTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (channelsSaveTails.get(key) === tail) channelsSaveTails.delete(key);
  }
}

function resolveChannelsScope(event: Parameters<RequestHandler>[0]): ChannelsRequestScope {
  const auth = resolveTrustedHostSessionSnapshot(event);
  if (auth.authenticated) {
    const signedWorkspaceSessionId = resolveSignedWorkspaceSessionId(event);
    if (signedWorkspaceSessionId !== event.params.id) error(404, "Session not found");
  }
  return {
    organizationId: auth.authenticated && auth.organizationId
      ? auth.organizationId
      : LOCAL_CHANNEL_ORGANIZATION_ID,
    userId: auth.authenticated && auth.userId ? auth.userId : LOCAL_CHANNEL_USER_ID,
    workspaceId: event.params.id,
    sessionId: event.params.id,
  };
}

async function loadEnvelope(event: Parameters<RequestHandler>[0]): Promise<ChannelsStateEnvelope> {
  const snapshots = await listRequestWorkspacePageContextSnapshots<unknown>(event, event.params.id);
  return readLatestChannelsEnvelope(snapshots);
}

export const GET: RequestHandler = async (event) => {
  const scope = resolveChannelsScope(event);
  const session = await getRequestWorkspaceSession(event, event.params.id);
  if (!session) error(404, "Session not found");
  return json(createChannelsProjection({ scope, envelope: await loadEnvelope(event) }), {
    headers: PRIVATE_HEADERS,
  });
};

export const POST: RequestHandler = async (event) => {
  const scope = resolveChannelsScope(event);
  const session = await getRequestWorkspaceSession(event, event.params.id);
  if (!session) error(404, "Session not found");

  let rawBody: unknown;
  try {
    rawBody = await event.request.json();
  } catch {
    return json({ ok: false, disabledReason: "invalid_trigger_binding", message: "Request body must be valid JSON." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const body = saveFixtureTriggerBindingBodySchema.safeParse(rawBody);
  if (!body.success) {
    return json({ ok: false, disabledReason: "invalid_trigger_binding", message: body.error.issues[0]?.message ?? "Trigger binding is invalid." }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const binding = createScopedFixtureTriggerBinding(body.data, scope);
  if (!binding.ok) {
    return json(binding, { status: 400, headers: PRIVATE_HEADERS });
  }

  const envelope = await withChannelsSaveLock(scope, async () => {
    const next = mergeTriggerBindingIntoEnvelope(await loadEnvelope(event), binding.binding);
    await recordRequestWorkspacePageContextSnapshot(
      event,
      createChannelsSnapshotRecordInput(scope, next),
    );
    return next;
  });
  return json({
    ok: true,
    projection: createChannelsProjection({ scope, envelope }),
    bindingId: binding.binding.bindingId,
    message: "Fixture trigger binding saved. Integration activation remains unavailable.",
  }, { headers: PRIVATE_HEADERS });
};

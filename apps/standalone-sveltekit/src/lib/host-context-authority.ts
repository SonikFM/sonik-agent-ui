import type { AgentHostMergedPageContext } from "@sonik-agent-ui/agent-embed";

export function hasSignedHostContext(context: AgentHostMergedPageContext | null | undefined): boolean {
  return Boolean(
    context?.hostSession
      && context.authenticated === true
      && context.organizationId
      && context.signatureVersion
      && context.issuedAt
      && context.expiresAt
      && context.signature,
  );
}

export function isSignedHostContextExpired(context: AgentHostMergedPageContext | null | undefined, nowMs = Date.now()): boolean {
  const expiresAt = context?.expiresAt ?? context?.hostSession?.expiresAt;
  if (!expiresAt) return true;
  const expiryMs = Date.parse(expiresAt);
  return !Number.isFinite(expiryMs) || expiryMs <= nowMs + 5_000;
}

export function selectSignedWorkspaceHostContext(input: {
  current: AgentHostMergedPageContext | null | undefined;
  cached: AgentHostMergedPageContext | null | undefined;
  nowMs?: number;
}): AgentHostMergedPageContext | null {
  const nowMs = input.nowMs ?? Date.now();
  if (hasSignedHostContext(input.current) && !isSignedHostContextExpired(input.current, nowMs)) return input.current ?? null;
  if (input.current) return null;
  if (hasSignedHostContext(input.cached) && !isSignedHostContextExpired(input.cached, nowMs)) return input.cached ?? null;
  return null;
}

export function nextSignedWorkspaceHostContextCache(input: {
  next: AgentHostMergedPageContext | null | undefined;
  nowMs?: number;
}): AgentHostMergedPageContext | null {
  const nowMs = input.nowMs ?? Date.now();
  return hasSignedHostContext(input.next) && !isSignedHostContextExpired(input.next, nowMs) ? input.next ?? null : null;
}

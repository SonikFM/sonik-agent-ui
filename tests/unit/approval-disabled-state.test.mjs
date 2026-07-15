import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveApprovalDisabledState } from "../../packages/chat-surface/src/approval-disabled-state.ts";

const streamingMessage = "Wait for the current response to finish before using approval actions.";

assert.equal(resolveApprovalDisabledState({ isStreaming: false, disabled: false, reason: null }), null, "enabled approval actions must not retain stale disabled state");
assert.deepEqual(
  resolveApprovalDisabledState({ isStreaming: true, disabled: true, reason: "trusted_host_approval_required" }),
  { code: "streaming", message: streamingMessage },
  "streaming must take precedence over any affordance-level disabled reason",
);
assert.deepEqual(
  resolveApprovalDisabledState({ isStreaming: false, disabled: true, reason: "trusted_host_approval_required" }),
  { code: "trusted_host_approval_required", message: "A trusted host approval is required before using approval actions." },
  "known affordance machine codes must map to stable typed codes and human copy",
);
assert.deepEqual(
  resolveApprovalDisabledState({ isStreaming: false, disabled: true, reason: "Answer setup type and inventory before previewing." }),
  { code: "approval_not_ready", message: "Answer setup type and inventory before previewing." },
  "already-human reasons must remain visible while data attributes use a stable fallback code",
);
assert.deepEqual(
  resolveApprovalDisabledState({ isStreaming: false, disabled: true, reason: "unknown_machine_reason" }),
  { code: "approval_not_ready", message: "Approval actions are not ready yet." },
  "unknown machine codes must not leak into visible copy or data attributes",
);
assert.deepEqual(
  resolveApprovalDisabledState({ isStreaming: false, disabled: true, reason: null }),
  { code: "approval_not_ready", message: "Approval actions are not ready yet." },
  "disabled affordances without a reason must still expose a non-empty typed and human state",
);

const agentConversation = await readFile("packages/chat-surface/src/components/AgentConversation.svelte", "utf8");
const toolCallBlock = await readFile("packages/chat-surface/src/components/ToolCallBlock.svelte", "utf8");
const approvalActions = agentConversation.match(/<div class="flex min-w-0 flex-1 basis-72 flex-wrap gap-2" data-chat-approval-actions>[\s\S]*?<\/div>/)?.[0] ?? "";

assert.match(agentConversation, /const approvalDisabledState = \$derived\(resolveApprovalDisabledState/);
assert.match(agentConversation, /id=\{APPROVAL_DISABLED_REASON_ID\}[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*data-approval-disabled-reason[\s\S]*data-disabled-reason=\{approvalDisabledState\.code\}/);
assert.equal((approvalActions.match(/disabled=\{approvalDisabledState !== null\}/g) ?? []).length, 3, "all three known approval controls must share the one derived native disabled state");
assert.equal((approvalActions.match(/data-disabled-reason=\{approvalDisabledState\?\.code\}/g) ?? []).length, 3, "all three approval controls must expose the shared typed disabled code");
assert.equal((approvalActions.match(/aria-describedby=\{approvalDisabledState \? APPROVAL_DISABLED_REASON_ID : undefined\}/g) ?? []).length, 3, "all three approval controls must conditionally describe themselves with the visible reason");
assert.match(approvalActions, /data-approval-action="preview"[\s\S]*data-approval-action="approve"[\s\S]*data-approval-action="cancel"/, "approval control order must remain Preview, Approve, Cancel");
assert.doesNotMatch(toolCallBlock, /<button\b/, "ToolCallBlock has no button controls, so G011 must not invent disabled-control behavior there");
assert.doesNotMatch(toolCallBlock, /aria-disabled|\bdisabled=/, "ToolCallBlock has no disabled controls requiring a fake reason contract");

console.log(JSON.stringify({ ok: true, checked: "approval-disabled-state" }));

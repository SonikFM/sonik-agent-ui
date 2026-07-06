import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWorkflowSuggestions } from "../../apps/standalone-sveltekit/src/lib/agent-workflows/suggestions.ts";

const agentConversation = await readFile(new URL("../../packages/chat-surface/src/components/AgentConversation.svelte", import.meta.url), "utf8");
const toolCallBlock = await readFile(new URL("../../packages/chat-surface/src/components/ToolCallBlock.svelte", import.meta.url), "utf8");
const canvasToolbar = await readFile(new URL("../../packages/workspace-core/src/components/CanvasToolbar.svelte", import.meta.url), "utf8");
const canvasViewport = await readFile(new URL("../../packages/workspace-core/src/components/CanvasViewport.svelte", import.meta.url), "utf8");
const appPage = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/+page.svelte", import.meta.url), "utf8");
const appLoad = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/+page.ts", import.meta.url), "utf8");

assert.match(toolCallBlock, /<details/);
assert.match(toolCallBlock, /Technical tool receipt/);
assert.match(toolCallBlock, /activity\.technicalLabel/);
assert.match(toolCallBlock, /data-tool-phase=\{activity\.phase\}/);
assert.match(toolCallBlock, /data-tool-state=\{stateLabel\}/);
assert.doesNotMatch(toolCallBlock, /title=\{.*technicalLabel/);

assert.match(agentConversation, /data-workflow-suggestion=\{suggestion\.familyId/);
assert.match(agentConversation, /data-workflow-readiness=\{suggestion\.readiness/);
assert.match(agentConversation, /grid gap-3 sm:grid-cols-2/);
assert.match(agentConversation, /readinessLabel/);
assert.match(agentConversation, /AgentApprovalAffordance/);
assert.match(agentConversation, /data-chat-approval-card/);
assert.match(agentConversation, /data-approval-action="approve"/);
assert.match(appPage, /createActiveIntakeApprovalAffordance/);
assert.match(appPage, /handleTrustedIntakeControllerAction\("approveAndRun"/);
assert.match(appPage, /json_render\.action\.error/);

const suggestions = createWorkflowSuggestions(null);
assert.equal(suggestions.length, 4);
for (const suggestion of suggestions) {
  assert.ok(suggestion.description.length > 20, `${suggestion.skillId} needs enterprise card copy`);
  assert.ok(suggestion.readinessLabel.length > 0, `${suggestion.skillId} needs a readiness badge`);
  assert.match(["ready", "needs_context", "approval_required", "draft_only"].join("|"), new RegExp(suggestion.readiness));
}
assert.equal(suggestions.find((entry) => entry.skillId === "booking.reservation.create")?.readiness, "needs_context");
assert.equal(suggestions.find((entry) => entry.skillId === "booking.context.intake")?.readiness, "draft_only");

assert.match(canvasToolbar, /showDeveloperPanels\?: boolean/);
assert.match(canvasToolbar, /developer\?: boolean/);
assert.match(canvasToolbar, /panelButtons = \$derived\(allPanelButtons\.filter\(\(item\) => showDeveloperPanels \|\| !item\.developer\)\)/);
assert.match(canvasViewport, /showDeveloperPanels = true/);
assert.match(canvasViewport, /!showDeveloperPanels && isDeveloperPanel/);
assert.match(appLoad, /embeddedHostContextExpected: url\.searchParams\.has\("agentUiHostOrigin"\)/);
assert.match(appPage, /import \{ browser, dev \} from "\$app\/environment"/);
assert.match(appPage, /let embeddedHostContextExpected = \$state\(browser && new URLSearchParams\(window\.location\.search\)\.has\("agentUiHostOrigin"\)\)/);
assert.match(appPage, /const showCanvasDeveloperPanels = \$derived\(dev \|\| !isEmbeddedHostContextExpected\(\)\)/);
assert.match(appPage, /showDeveloperPanels=\{showCanvasDeveloperPanels\}/);
assert.match(appPage, /approvalAffordance=\{createActiveIntakeApprovalAffordance\(\)\}/);

console.log("enterprise-agent-ux-foundation tests passed");

import assert from "node:assert/strict";
import { commandDescriptorSchema, evaluateCommandPolicy } from "../../packages/tool-contracts/src/index.ts";

function makeCommand(overrides = {}) {
  return commandDescriptorSchema.parse({
    id: "test.read",
    title: "Test Read Command",
    familyId: "test-family",
    source: "local-ui",
    effect: "read",
    approval: "none",
    transport: { runtimeStatus: "mounted" },
    output: { summary: "test" },
    policy: { readOnly: true },
    ...overrides,
  });
}

const readCommand = makeCommand();
const mutationCommand = makeCommand({
  id: "test.mutation",
  title: "Test Mutation Command",
  effect: "write",
  approval: "required",
  policy: { readOnly: false },
});

// 1. No policy input -> decisions identical to today (golden parity).
const goldenExecute = evaluateCommandPolicy(readCommand, { action: "execute" });
assert.deepEqual(goldenExecute, { decision: "allow", reasons: ["policy_allowed"] }, "golden parity: mounted read execute with no policy input");

const goldenApprovedCommit = evaluateCommandPolicy(mutationCommand, { action: "commit", approved: true });
assert.deepEqual(goldenApprovedCommit, { decision: "allow", reasons: ["policy_allowed"] }, "golden parity: approved commit with no policy input");

const goldenUnapprovedCommit = evaluateCommandPolicy(mutationCommand, { action: "commit", approved: false });
assert.deepEqual(goldenUnapprovedCommit, { decision: "needs_approval", reasons: ["approval_required"] }, "golden parity: unapproved commit with no policy input");

// 2. Family `off` -> deny with tool_policy_off, even when the commandId IS in approvedCommandIds (most-restrictive-wins proof).
const familyOffDespiteApproval = evaluateCommandPolicy(mutationCommand, {
  action: "commit",
  approved: true,
  toolPolicy: { familyModes: { "test-family": "off" } },
});
assert.equal(familyOffDespiteApproval.decision, "deny", "family off must deny even when host-approved");
assert.ok(familyOffDespiteApproval.reasons.includes("tool_policy_off"), "deny reason must name tool_policy_off");

// 3. Per-command `ask` + approved:false -> needs_approval with tool_policy_requires_approval.
const commandAskUnapproved = evaluateCommandPolicy(readCommand, {
  action: "execute",
  approved: false,
  toolPolicy: { commandModes: { "test.read": "ask" } },
});
assert.deepEqual(commandAskUnapproved, { decision: "needs_approval", reasons: ["tool_policy_requires_approval"] }, "per-command ask + unapproved must need approval");

// 4. Per-command `ask` + approved:true -> allow (approval satisfies ask).
const commandAskApproved = evaluateCommandPolicy(readCommand, {
  action: "execute",
  approved: true,
  toolPolicy: { commandModes: { "test.read": "ask" } },
});
assert.deepEqual(commandAskApproved, { decision: "allow", reasons: ["policy_allowed"] }, "per-command ask + approved must allow");

// 5. Family `allow` + command `off` -> deny (per-command more restrictive wins).
const familyAllowCommandOff = evaluateCommandPolicy(readCommand, {
  action: "execute",
  toolPolicy: { familyModes: { "test-family": "allow" }, commandModes: { "test.read": "off" } },
});
assert.equal(familyAllowCommandOff.decision, "deny", "per-command off must win over family allow");
assert.ok(familyAllowCommandOff.reasons.includes("tool_policy_off"), "deny reason must name tool_policy_off");

// 6. Family `ask` + command `allow` -> ask (most-restrictive-wins across layers).
const familyAskCommandAllow = evaluateCommandPolicy(readCommand, {
  action: "execute",
  approved: false,
  toolPolicy: { familyModes: { "test-family": "ask" }, commandModes: { "test.read": "allow" } },
});
assert.deepEqual(familyAskCommandAllow, { decision: "needs_approval", reasons: ["tool_policy_requires_approval"] }, "family ask must win over command allow");

// 7. Effective `allow` grants nothing extra: unapproved required-approval commit still needs_approval.
const effectiveAllowStillNeedsApproval = evaluateCommandPolicy(mutationCommand, {
  action: "commit",
  approved: false,
  toolPolicy: { familyModes: { "test-family": "allow" } },
});
assert.deepEqual(effectiveAllowStillNeedsApproval, { decision: "needs_approval", reasons: ["approval_required"] }, "tool-policy allow cannot loosen the existing approval_required gate");

console.log("tool policy enforcement tests passed");

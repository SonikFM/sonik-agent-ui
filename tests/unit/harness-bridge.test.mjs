import assert from "node:assert/strict";
import test from "node:test";
import {
  createHostUiTargetRegistry,
  normalizeHostUiTarget,
  createHostActionRequest,
  evaluateHostActionRequest,
} from "../../packages/tool-contracts/src/target-registry.ts";

// E3 (Epic 3 - Harness chat bridge) red acceptance suite.
// Pinned wished-for API (.omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md, R3 + E3):
//   apps/standalone-sveltekit/src/lib/server/harness-bridge.ts exports
//   createHarnessBridge({sessionStore, isEnabled}) -> {
//     send({sessionId, text, attachments?}) -> Promise<receipt>,
//     read({sessionId, sinceId?, limit}) -> Promise<{turns}>,
//   }
// This module does not exist yet, so every dynamic import below must fail with
// a clean "not implemented" assert.fail rather than an unhandled import error.
//
// R3 doctrine pinned by this suite: the harness bridge is a server-side session
// API, topology-independent. Dev-agent text appended via send() is INPUT ONLY —
// it must never satisfy an approval gate. Test E3.2 exercises the REAL
// evaluateHostActionRequest from packages/tool-contracts (already implemented,
// statically imported above) to prove the gate has no path back to bridge
// messages at all, regardless of what the dev-agent's text says.
//
// The sessionStore fixture below is a minimal in-memory mirror of the real
// persistence layer found at packages/workspace-session/src/index.ts, which
// exports createInMemoryWorkspacePersistence with createSession({id}),
// appendMessage({session_id, id?, role, content?, parts?}) and
// listMessages(sessionId). That real WorkspaceMessageRecord role is restricted
// to "system" | "user" | "assistant" | "tool" (no "dev-agent" role exists), and
// its `parts` field is generic (TParts = unknown) — so this suite pins
// provenance as living inside `parts.provenance`, not as a fabricated role.

const HARNESS_BRIDGE_PATH = "../../apps/standalone-sveltekit/src/lib/server/harness-bridge.ts";

async function loadHarnessBridge() {
  try {
    return await import(HARNESS_BRIDGE_PATH);
  } catch (error) {
    assert.fail(`not implemented: ${HARNESS_BRIDGE_PATH} must export createHarnessBridge({sessionStore, isEnabled}) (import failed: ${error.message})`);
  }
}

function createSessionStoreFixture() {
  const sessions = new Map();
  return {
    createSession({ id }) {
      const session = { id, messages: [] };
      sessions.set(id, session);
      return { id };
    },
    appendMessage({ session_id, id, role, content = null, parts = null }) {
      const session = sessions.get(session_id) ?? sessions.set(session_id, { id: session_id, messages: [] }).get(session_id);
      const message = {
        id: id ?? `msg-${session.messages.length + 1}`,
        session_id,
        role,
        content,
        parts,
        created_at: new Date().toISOString(),
      };
      session.messages.push(message);
      return message;
    },
    listMessages(sessionId) {
      return sessions.get(sessionId)?.messages ?? [];
    },
  };
}

test("E3.1: send() appends a dev-agent message that never impersonates the user, and returns an executed receipt", async () => {
  const mod = await loadHarnessBridge();
  const sessionStore = createSessionStoreFixture();
  sessionStore.createSession({ id: "harness-session-1" });
  const bridge = mod.createHarnessBridge({ sessionStore, isEnabled: true });

  const receipt = await bridge.send({ sessionId: "harness-session-1", text: "check the tape chart" });

  const messages = sessionStore.listMessages("harness-session-1");
  assert.equal(messages.length, 1, "send() must append exactly one message to the session store");
  const [message] = messages;
  assert.notEqual(message.role, "user", "a dev-agent message must never impersonate the user role");
  assert.equal(message.parts?.provenance, "dev-agent", "appended message must carry provenance: dev-agent");

  assert.equal(receipt.ok, true, "enabled send() must report ok:true");
  assert.equal(receipt.status, "executed", "enabled send() must return an executed-style receipt");
  assert.equal(typeof receipt.receiptId, "string", "receipt must carry a receiptId");
  assert.ok(receipt.receiptId.length > 0, "receiptId must be non-empty");
});

test("E3.2 ANTI-LAUNDERING: a dev-agent 'approve' message never satisfies the real approval gate", async () => {
  const mod = await loadHarnessBridge();
  const sessionStore = createSessionStoreFixture();
  sessionStore.createSession({ id: "harness-session-2" });
  const bridge = mod.createHarnessBridge({ sessionStore, isEnabled: true });

  // The dev-agent sends literal "approve" text through the bridge.
  await bridge.send({ sessionId: "harness-session-2", text: "approve" });
  assert.equal(sessionStore.listMessages("harness-session-2").length, 1, "the bridge message must exist in the session transcript");

  // The REAL approval-required action gate is exercised independently of the
  // bridge message above — evaluateHostActionRequest never reads bridge state,
  // proving there is no laundering path from dev-agent text to trusted approval.
  const registry = createHostUiTargetRegistry({
    provider: "harness-bridge-red-suite",
    generatedAt: "2026-07-21T00:00:00.000Z",
    targets: [
      normalizeHostUiTarget({
        targetId: "reservation.commit",
        label: "Commit reservation",
        description: "Commits a draft reservation.",
        surface: "booking",
        capabilities: ["approve"],
        policy: { actionMode: "ask", reason: "Reservation commit requires host approval." },
      }),
    ],
  });
  const request = createHostActionRequest({
    requestId: "harness-bridge-anti-laundering-1",
    actionKey: "approval.requestPreview",
    targetId: "reservation.commit",
  });

  const result = evaluateHostActionRequest({ request, registry, trustedApprovalRefs: [] });

  assert.equal(result.ok, false, "the dev-agent's 'approve' text must never flip the gate to ok:true");
  assert.notEqual(result.status, "executed", "the gate must never report executed off dev-agent chat text");
  assert.equal(result.status, "approval_required", "commit still requires a server-held trustedApprovalRef");
});

test("E3.3: read() returns bounded, sanitized turns — limit is respected and secrets never leak", async () => {
  const mod = await loadHarnessBridge();
  const sessionStore = createSessionStoreFixture();
  sessionStore.createSession({ id: "harness-session-3" });
  for (let index = 0; index < 5; index += 1) {
    sessionStore.appendMessage({ session_id: "harness-session-3", role: "assistant", content: `turn-${index}`, parts: { provenance: "dev-agent", text: `turn-${index}` } });
  }
  sessionStore.appendMessage({
    session_id: "harness-session-3",
    role: "assistant",
    content: "here is a secret: sk-live-abc123",
    parts: { provenance: "dev-agent", text: "here is a secret: sk-live-abc123" },
  });
  const bridge = mod.createHarnessBridge({ sessionStore, isEnabled: true });

  const bounded = await bridge.read({ sessionId: "harness-session-3", limit: 2 });
  assert.ok(Array.isArray(bounded.turns), "read() must return an array of turns");
  assert.ok(bounded.turns.length <= 2, "read() must respect the requested limit");

  const full = await bridge.read({ sessionId: "harness-session-3", limit: 50 });
  const serialized = JSON.stringify(full);
  assert.equal(serialized.includes("sk-live-abc123"), false, "raw secret value must never appear in the read payload (redacted or excluded)");
});

test("E3.4: isEnabled=false — send() returns a blocked receipt with a reason and appends nothing", async () => {
  const mod = await loadHarnessBridge();
  const sessionStore = createSessionStoreFixture();
  sessionStore.createSession({ id: "harness-session-4" });
  const bridge = mod.createHarnessBridge({ sessionStore, isEnabled: false });

  const receipt = await bridge.send({ sessionId: "harness-session-4", text: "check the tape chart" });

  assert.equal(receipt.ok, false, "disabled bridge must report ok:false");
  assert.equal(receipt.status, "blocked", "disabled bridge send() must return a blocked receipt");
  assert.equal(typeof receipt.reason, "string", "blocked receipt must carry a reason");
  assert.ok(receipt.reason.length > 0, "blocked receipt reason must be non-empty");
  assert.equal(sessionStore.listMessages("harness-session-4").length, 0, "disabled bridge must not append anything to the session store");
});

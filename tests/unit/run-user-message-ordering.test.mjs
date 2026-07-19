import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { persistInitiatingUserMessage } from "../../apps/standalone-sveltekit/src/lib/server/run-event-log.ts";
import { createInMemoryWorkspacePersistence } from "../../packages/workspace-session/src/index.ts";

const pageSource = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
const generateFetchBlock = pageSource.match(/async function fetchGenerateWithSupportCorrelation[\s\S]*?\n  function upsertSupportCorrelation/)?.[0] ?? "";

assert.match(generateFetchBlock, /await persistConversationMessages\(\)[\s\S]*await fetchWithHostAuthorityRecovery\(input, init\)/, "the user message must reach persistence before a run can reference it, including the one bounded authority replay");
assert.equal(generateFetchBlock.includes("!persistedMessageIds.has(userMessageId)"), true, "generation must fail closed when the initiating user message was not persisted");

const userMessage = { id: "message-user", role: "user", parts: [{ type: "text", text: "hello" }] };

{
  const persistence = createInMemoryWorkspacePersistence();
  persistence.createSession({ id: "direct-generate-session" });
  const message = { ...userMessage, id: "direct-generate-message", parts: [...userMessage.parts, { type: "data-provenance", data: { source: "direct", attempt: 1 } }] };
  await persistInitiatingUserMessage({ persistence, sessionId: "direct-generate-session", message });
  await persistInitiatingUserMessage({ persistence, sessionId: "direct-generate-session", message: { ...message, parts: [message.parts[0], { type: "data-provenance", data: { attempt: 1, source: "direct" } }] } });
  await assert.rejects(() => persistInitiatingUserMessage({ persistence, sessionId: "direct-generate-session", message: { ...message, parts: [{ type: "text", text: "changed" }, message.parts[1]] } }), /different payload/);
  await assert.rejects(() => persistInitiatingUserMessage({ persistence, sessionId: "direct-generate-session", message: { ...message, parts: [message.parts[0], { type: "data-provenance", data: { source: "direct", attempt: 2 } }] } }), /different payload/);
}

{
  const calls = [];
  const persistence = {
    getSession: async (sessionId) => {
      calls.push(["getSession", sessionId]);
      return { id: sessionId };
    },
    appendMessage: async (input) => {
      calls.push(["appendMessage", input]);
      return { ...input, content: input.content ?? "", parts: input.parts ?? null, created_at: "2026-07-13T00:00:00.000Z" };
    },
    createRun: async (input) => {
      calls.push(["createRun", input]);
      return input;
    },
  };
  await persistInitiatingUserMessage({ persistence, sessionId: "session-a", message: userMessage });
  await persistence.createRun({ session_id: "session-a", user_message_id: userMessage.id });
  assert.deepEqual(calls.map(([name]) => name), ["getSession", "appendMessage", "createRun"], "direct callers persist the initiating message before createRun");
  assert.deepEqual(calls[1][1], { id: "message-user", session_id: "session-a", role: "user", content: "hello", parts: userMessage.parts });
}

{
  const existing = { id: "message-user", session_id: "session-a", role: "user", content: "hello", parts: userMessage.parts, created_at: "2026-07-13T00:00:00.000Z" };
  await persistInitiatingUserMessage({
    persistence: {
      getSession: async () => ({ id: "session-a" }),
      appendMessage: async () => existing,
    },
    sessionId: "session-a",
    message: userMessage,
  });
}

for (const existing of [
  { id: "message-user", session_id: "session-a", role: "assistant", content: "wrong role", parts: null, created_at: "2026-07-13T00:00:00.000Z" },
  { id: "message-user", session_id: "session-b", role: "user", content: "wrong session", parts: null, created_at: "2026-07-13T00:00:00.000Z" },
  { id: "message-user", session_id: "session-a", role: "user", content: "changed", parts: userMessage.parts, created_at: "2026-07-13T00:00:00.000Z" },
  { id: "message-user", session_id: "session-a", role: "user", content: "hello", parts: [{ type: "text", text: "changed" }], created_at: "2026-07-13T00:00:00.000Z" },
]) {
  await assert.rejects(
    () => persistInitiatingUserMessage({
      persistence: {
        getSession: async () => ({ id: "session-a" }),
        appendMessage: async () => existing,
      },
      sessionId: "session-a",
      message: userMessage,
    }),
    /user message provenance/i,
  );
}

const generateSource = await readFile("apps/standalone-sveltekit/src/routes/api/generate/+server.ts", "utf8");
const directGenerateOrder = generateSource.match(/const lastMessage[\s\S]*?const result = await agent\.stream/)?.[0] ?? "";
assert.match(directGenerateOrder, /await persistInitiatingUserMessage/, "generate itself persists or validates the latest user message for direct callers");
assert.equal(directGenerateOrder.indexOf("persistInitiatingUserMessage") < directGenerateOrder.indexOf("startRunRecorder"), true, "message provenance is established before createRun");
assert.equal(directGenerateOrder.indexOf("startRunRecorder") < directGenerateOrder.indexOf("agent.stream"), true, "durable run creation completes before the model call starts");
assert.match(directGenerateOrder, /body\.trigger !== "regenerate-message" \|\| typeof body\.messageId === "string" && body\.messageId\.trim\(\)/, "regeneration requires the SDK target assistant id even though the assistant is absent from messages");
assert.match(directGenerateOrder, /lastMessage\?\.role === "user"[\s\S]*lastMessage\.id\.trim\(\)[\s\S]*\? lastMessage[\s\S]*: undefined/, "all submissions bind to the exact final id-bearing user turn");
assert.match(directGenerateOrder, /userMessageId:\s*activeUserMessage\?\.id/, "run user_message_id keeps the initiating user id");
assert.doesNotMatch(directGenerateOrder, /messageId:\s*activeUserMessage/, "assistant message_id semantics remain separate from initiating user provenance");

const orderedMessages = [
  { id: "user-one", role: "user", parts: [{ type: "text", text: "first" }] },
  { id: "assistant-one", role: "assistant", parts: [{ type: "text", text: "reply" }] },
  { id: "user-two", role: "user", parts: [{ type: "text", text: "second" }] },
];
assert.equal(selectExpectedActiveUserMessage(orderedMessages, "submit-message")?.id, "user-two", "normal submit selects the exact final user");
assert.equal(selectExpectedActiveUserMessage(orderedMessages.slice(0, 2), "submit-message"), undefined, "normal submit rejects a final assistant");
assert.equal(selectExpectedActiveUserMessage(orderedMessages, "regenerate-message", "assistant-two")?.id, "user-two", "SDK-shaped regeneration binds to the exact final initiating user after removing the target assistant");
assert.equal(selectExpectedActiveUserMessage(orderedMessages, "regenerate-message", ""), undefined, "blank regeneration targets fail closed");
assert.equal(selectExpectedActiveUserMessage(orderedMessages.slice(0, 2), "regenerate-message", "assistant-two"), undefined, "regeneration rejects a final assistant");
assert.equal(selectExpectedActiveUserMessage([{ role: "user", parts: [] }], "regenerate-message", "assistant-two"), undefined, "regeneration rejects a user without an id");
await assert.rejects(() => persistInitiatingUserMessage({ persistence: { getSession: async () => ({ id: "session-a" }) }, sessionId: "session-a", message: selectExpectedActiveUserMessage(orderedMessages.slice(0, 2), "submit-message") }), /user message with an id/i);
await assert.rejects(() => persistInitiatingUserMessage({ persistence: { getSession: async () => ({ id: "session-a" }) }, sessionId: "session-a", message: selectExpectedActiveUserMessage(orderedMessages, "regenerate-message", "") }), /user message with an id/i);

const generateExecutionOrder = generateSource.slice(generateSource.indexOf("let runRecorder"), generateSource.indexOf("const result = await agent.stream"));
assert.equal(generateExecutionOrder.indexOf("startRunRecorder") < generateExecutionOrder.indexOf("const agent = createAgent"), true, "run creation completes before createAgent executes");
assert.match(generateExecutionOrder, /let runRecorder:[^;]+null;[\s\S]*if \(telemetrySessionId\)/, "requests without a session preserve the null-recorder streaming path");
assert.equal((generateSource.match(/await finalizeRunFailure\(runRecorder, error\)/g) ?? []).length, 2, "pre-stream model and outer route failures await durable run finalization");
assert.match(generateSource, /createUIMessageStreamResponse\(\{ stream: runRecorder \? teeRunEvents\(stream, runRecorder\) : stream \}\)/, "client-facing stream success, failure, and cancellation finalize through the outer recorder tee");
assert.match(generateSource, /createGenerateFailureResponse\(\{ error, responseHeaders, runRecorder \}\)/, "outer failures preserve the durable run id in the response");

console.log("run-user-message-ordering.test.mjs: all assertions passed");

function selectExpectedActiveUserMessage(messages, trigger, messageId) {
  const lastMessage = messages.at(-1);
  const validTrigger = trigger !== "regenerate-message" || typeof messageId === "string" && messageId.trim();
  return validTrigger && lastMessage?.role === "user" && lastMessage.id?.trim() ? lastMessage : undefined;
}

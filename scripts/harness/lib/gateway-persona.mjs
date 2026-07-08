// Path B: an actual gateway LLM call plays the persona's turns, instead of a
// human/Claude reading each response and deciding the next message by hand
// (Path A). Reads the same environment variable + gateway client the app
// itself uses (apps/standalone-sveltekit/src/lib/ai-gateway.ts):
//   AI_GATEWAY_API_KEY  (required — createGateway({apiKey}))
//   AI_GATEWAY_MODEL    (optional — defaults to a fast chat model for the
//                        persona side; unrelated to the app's own
//                        AI_GATEWAY_MODEL, which selects the agent's model)
//
// This module must never be imported/called without AI_GATEWAY_API_KEY set;
// callers are expected to check `hasGatewayCredentials()` first and fail with
// a clear, explicit message otherwise (see persona-run.mjs's `batch` command).

import { generateText } from "ai";

export function hasGatewayCredentials(env = process.env) {
  return Boolean(env.AI_GATEWAY_API_KEY);
}

const DEFAULT_PERSONA_MODEL = "anthropic/claude-haiku-4.5";

/**
 * Ask the gateway model to produce the persona's next chat message, given
 * the persona description and the conversation so far (assistant's last
 * rendered text + any open questions detected in the artifact).
 */
export async function generatePersonaTurn({ persona, transcript, openQuestions, isOpeningTurn, apiKey, modelId }) {
  const { createGateway } = await import("@ai-sdk/gateway");
  const gateway = createGateway({ apiKey });
  const resolvedModel = modelId ?? process.env.AI_GATEWAY_PERSONA_MODEL ?? DEFAULT_PERSONA_MODEL;

  const systemPrompt = [
    `You are role-playing ${persona.name}, ${persona.role}, in a live chat with a booking-setup assistant.`,
    `Voice: ${persona.voice}`,
    "Reply with ONLY the next chat message this persona would type — natural language, no markdown headers, no meta-commentary, no form-filling JSON.",
    "Stay in character and answer based on what the assistant just said/asked. Keep it realistic in length for this persona's voice (terse personas stay short).",
    isOpeningTurn ? "This is the opening message of the conversation — state the request naturally, the way this persona would open." : "This is a follow-up reply — answer what was just asked, or move the conversation forward if nothing was asked.",
  ].join("\n");

  const conversationSummary = transcript
    .slice(-6)
    .map((turn) => `${turn.role === "user" ? persona.name : "assistant"}: ${turn.text}`)
    .join("\n\n");

  const openQuestionsSummary = openQuestions.length > 0 ? `Open questions the assistant is currently asking:\n${openQuestions.map((question) => `- ${question.title}`).join("\n")}` : "";

  const userPrompt = isOpeningTurn
    ? `Write ${persona.name}'s opening message. They want: ${persona.openers[0]}`
    : [`Conversation so far:`, conversationSummary, openQuestionsSummary, `Write ${persona.name}'s next reply.`].filter(Boolean).join("\n\n");

  const result = await generateText({
    model: gateway(resolvedModel),
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 300,
  });
  return result.text.trim();
}

import { createGateway } from "@ai-sdk/gateway";
import { env } from "$env/dynamic/private";
import { FALLBACK_AGENT_MODEL_ID, isValidAgentModelId } from "./agent-settings";

export const DEFAULT_MODEL = FALLBACK_AGENT_MODEL_ID;
export const MODEL_ID = isValidAgentModelId(env.AI_GATEWAY_MODEL) ? env.AI_GATEWAY_MODEL : DEFAULT_MODEL;
export const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });

export function resolveGatewayModelId(requestedModelId: unknown): string {
  if (isValidAgentModelId(requestedModelId)) return requestedModelId;
  return MODEL_ID;
}

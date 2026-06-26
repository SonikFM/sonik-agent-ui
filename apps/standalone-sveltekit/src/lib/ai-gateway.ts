import { createGateway } from "@ai-sdk/gateway";
import { env } from "$env/dynamic/private";

export const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
export const MODEL_ID = env.AI_GATEWAY_MODEL || DEFAULT_MODEL;
export const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });

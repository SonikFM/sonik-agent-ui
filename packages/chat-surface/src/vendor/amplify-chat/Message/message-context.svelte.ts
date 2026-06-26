import { getContext, setContext } from "svelte";

export type MessageRole = "user" | "assistant" | "system" | "tool";

const MESSAGE_CONTEXT = Symbol("amplify-message-context");

export interface MessageContext {
	from: MessageRole;
}

export function setMessageContext(context: MessageContext): MessageContext {
	setContext(MESSAGE_CONTEXT, context);
	return context;
}

export function getMessageContext(): MessageContext | undefined {
	return getContext<MessageContext | undefined>(MESSAGE_CONTEXT);
}

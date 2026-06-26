import { getContext, setContext } from "svelte";

const CONVERSATION_CONTEXT = Symbol("amplify-conversation-context");

export class ConversationContext {
	element = $state<HTMLElement | null>(null);
	isAtBottom = $state(true);

	setElement(element: HTMLElement | null): void {
		this.element = element;
		this.checkPosition();
	}

	checkPosition(): void {
		if (!this.element) return;
		const { scrollTop, scrollHeight, clientHeight } = this.element;
		this.isAtBottom = scrollTop + clientHeight >= scrollHeight - 96;
	}

	scrollToBottom(behavior: ScrollBehavior = "smooth"): void {
		if (!this.element) return;
		this.element.scrollTo({ top: this.element.scrollHeight, behavior });
		this.isAtBottom = true;
	}
}

export function setConversationContext(): ConversationContext {
	const context = new ConversationContext();
	setContext(CONVERSATION_CONTEXT, context);
	return context;
}

export function getConversationContext(): ConversationContext | undefined {
	return getContext<ConversationContext | undefined>(CONVERSATION_CONTEXT);
}

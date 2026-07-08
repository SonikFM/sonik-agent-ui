import { getContext, setContext } from "svelte";

const CONVERSATION_CONTEXT = Symbol("amplify-conversation-context");

// Distance (px) from the true bottom that still counts as "at bottom", and the
// distance a user has to scroll *upward* before we treat it as a deliberate
// "stop following" gesture rather than scroll jitter from streaming content.
const BOTTOM_THRESHOLD = 96;
const UP_SCROLL_THRESHOLD = 96;

export class ConversationContext {
	element = $state<HTMLElement | null>(null);
	isAtBottom = $state(true);
	/** Follow-while-streaming mode: sticks the transcript to the bottom as content
	 *  grows. On by default; disabled only when the user scrolls up past the
	 *  threshold, re-enabled once they return to (or request) the bottom. */
	followMode = $state(true);
	#lastScrollTop = 0;

	setElement(element: HTMLElement | null): void {
		this.element = element;
		this.#lastScrollTop = element?.scrollTop ?? 0;
		this.checkPosition();
	}

	checkPosition(): void {
		if (!this.element) return;
		const { scrollTop, scrollHeight, clientHeight } = this.element;
		this.isAtBottom = scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD;

		if (scrollTop < this.#lastScrollTop - UP_SCROLL_THRESHOLD) {
			this.followMode = false;
		} else if (this.isAtBottom) {
			this.followMode = true;
		}
		this.#lastScrollTop = scrollTop;
	}

	scrollToBottom(behavior: ScrollBehavior = "smooth"): void {
		if (!this.element) return;
		this.element.scrollTo({ top: this.element.scrollHeight, behavior });
		this.isAtBottom = true;
		this.followMode = true;
		this.#lastScrollTop = this.element.scrollHeight;
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

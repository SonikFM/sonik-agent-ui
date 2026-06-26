import Message from "./Message.svelte";
import MessageActions from "./MessageActions.svelte";
import MessageContent from "./MessageContent.svelte";
const MessageToolbar = MessageActions;
const MessageAction = MessageActions;
export {
	Message,
	MessageContent,
	MessageActions,
	MessageToolbar,
	MessageAction,
};
export {
	Message as Root,
	MessageContent as Content,
	MessageActions as Actions,
	MessageToolbar as Toolbar,
	MessageAction as Action,
};
export type { MessageProps } from "./Message.svelte";
export type { MessageContentProps } from "./MessageContent.svelte";
export type { MessageActionsProps } from "./MessageActions.svelte";
export type { MessageRole, MessageContext } from "./message-context.svelte.js";
export {
	getMessageContext,
	setMessageContext,
} from "./message-context.svelte.js";

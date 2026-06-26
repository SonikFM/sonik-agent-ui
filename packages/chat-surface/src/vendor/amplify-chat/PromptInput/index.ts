import Root from "./PromptInput.svelte";
import Body from "./PromptInputBody.svelte";
import Submit from "./PromptInputSubmit.svelte";
import Textarea from "./PromptInputTextarea.svelte";
import Toolbar from "./PromptInputToolbar.svelte";
const Header = Toolbar;
const Tools = Toolbar;
const Button = Submit;
export { Root, Body, Toolbar, Textarea, Submit, Header, Tools, Button };
export {
	Root as PromptInput,
	Body as PromptInputBody,
	Toolbar as PromptInputToolbar,
	Textarea as PromptInputTextarea,
	Submit as PromptInputSubmit,
};
export type {
	PromptInputProps,
	PromptInputMessage,
	ChatStatus,
} from "./PromptInput.svelte";
export type { PromptInputBodyProps } from "./PromptInputBody.svelte";
export type { PromptInputToolbarProps } from "./PromptInputToolbar.svelte";
export type { PromptInputTextareaProps } from "./PromptInputTextarea.svelte";
export type { PromptInputSubmitProps } from "./PromptInputSubmit.svelte";

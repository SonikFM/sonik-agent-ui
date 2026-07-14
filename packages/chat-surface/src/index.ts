export { default as AgentComposer } from "./components/AgentComposer.svelte";
export { default as AgentConversation } from "./components/AgentConversation.svelte";
export { default as AgentMessage } from "./components/AgentMessage.svelte";
export { default as ToolCallBlock } from "./components/ToolCallBlock.svelte";
export { default as ContextChip } from "./components/ContextChip.svelte";
export { default as ComposerContextMenu } from "./components/ComposerContextMenu.svelte";
export { default as ComposerAttachmentMenu } from "./components/ComposerAttachmentMenu.svelte";
export { default as ComposerSuggestions } from "./components/ComposerSuggestions.svelte";
export { default as ComposerToolSelector } from "./components/ComposerToolSelector.svelte";
export { default as StagedContextRow } from "./components/StagedContextRow.svelte";
export { default as AgentSettingsPanel } from "./components/AgentSettingsPanel.svelte";

export type { ContextChipProps } from "./components/ContextChip.svelte";
export type { ComposerContextMenuProps } from "./components/ComposerContextMenu.svelte";
export type { AgentSettingsPanelProps, AgentSettingsModelOption, AgentSettingsSkillOption, AgentSettingsToolFamily, AgentSettingsAddon, AgentToolPermissionMode } from "./components/AgentSettingsPanel.svelte";
export type { AgentChatStatus, AgentComposerProps } from "./components/AgentComposer.svelte";
export type { AgentActivityStatus, AgentApprovalAffordance, AgentConversationProps, AgentSuggestion } from "./components/AgentConversation.svelte";
export type { AgentChatMessage, AgentMessageProps } from "./components/AgentMessage.svelte";
export type { ToolCallBlockProps } from "./components/ToolCallBlock.svelte";
export type { ChatSegment, ChatSegmentsResult, ToolInfo } from "./message-parts.js";
export { getSegments, getSpec, getText, hasSpec, snapshotDataParts } from "./message-parts.js";
export { renderChatText, parseInline, parseTable } from "./chat-text.js";
export type { ChatTextBlock, InlineToken } from "./chat-text.js";
export { filterComposerSuggestions, findComposerTrigger, replaceComposerTrigger } from "./composer-context.js";
export type { ComposerCatalogStatus, ComposerRecentDocument, ComposerSuggestionItem, ComposerSuggestionKind, ComposerToolItem, ComposerTrigger } from "./composer-context.js";
export {
  TOOL_ACTIVITY_REGISTRY,
  normalizeToolName,
  resolveToolActivity,
  isToolActivityError,
  isToolActivityLoading,
} from "./tool-activity.js";
export type {
  ToolActivityDescriptor,
  ToolActivityLabelOverride,
  ToolActivityLabelOverrides,
  ToolActivityPhase,
  ToolActivityPresentation,
} from "./tool-activity.js";

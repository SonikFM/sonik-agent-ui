import type { AgentContextItem } from "@sonik-agent-ui/tool-contracts/run-context";

export type ComposerFileUploadState = ComposerFileUploadingState | ComposerFileFailedState;

export interface ComposerFileUploadingState {
  status: "uploading";
  id: string;
  label: string;
  file: File;
  controller: AbortController;
}

export interface ComposerFileFailedState {
  status: "failed";
  id: string;
  label: string;
  file: File;
  error: string;
}

export function createComposerFileUpload(
  file: File,
  id = crypto.randomUUID(),
  controller = new AbortController(),
): ComposerFileUploadingState {
  return { status: "uploading", id, label: file.name, file, controller };
}

export function failComposerFileUpload(
  upload: ComposerFileUploadingState,
  error: unknown,
): ComposerFileFailedState {
  return {
    status: "failed",
    id: upload.id,
    label: upload.label,
    file: upload.file,
    error: error instanceof Error ? error.message : "Upload failed",
  };
}

export function retryComposerFileUpload(
  upload: ComposerFileFailedState,
  controller = new AbortController(),
): ComposerFileUploadingState {
  return {
    status: "uploading",
    id: upload.id,
    label: upload.label,
    file: upload.file,
    controller,
  };
}

export async function executeComposerFileUpload(input: {
  upload: ComposerFileUploadingState;
  onUploadFile: (file: File, signal: AbortSignal) => Promise<AgentContextItem>;
  onAttachContext?: (item: AgentContextItem) => void;
}): Promise<ComposerFileFailedState | null> {
  try {
    const item = await input.onUploadFile(input.upload.file, input.upload.controller.signal);
    if (!input.upload.controller.signal.aborted) input.onAttachContext?.(item);
    return null;
  } catch (error) {
    if (input.upload.controller.signal.aborted) return null;
    return failComposerFileUpload(input.upload, error);
  }
}

export type ToolActivityPhase =
  | "capabilities"
  | "workflow_discovery"
  | "workflow_instructions"
  | "action_discovery"
  | "action_schema"
  | "safe_read"
  | "trusted_write"
  | "draft_read"
  | "approval_preview"
  | "canvas"
  | "document"
  | "data_lookup"
  | "web_lookup"
  | "unknown";

export interface ToolActivityDescriptor {
  pending: string;
  done: string;
  error: string;
  phase: ToolActivityPhase;
  /** Raw tool id retained for titles, telemetry joins, and debug surfaces. */
  technicalLabel: string;
}

export interface ToolActivityPresentation extends ToolActivityDescriptor {
  label: string;
  isLoading: boolean;
  isError: boolean;
}

export interface ToolActivityLabelOverride {
  pending?: string;
  done?: string;
  error?: string;
}

export type ToolActivityLabelOverrides = Record<string, ToolActivityLabelOverride>;

export interface ToolActivityOptions {
  /** True while the turn that produced this tool call is still streaming. */
  isTurnStreaming?: boolean;
  /** True when a later tool call of the same name in this turn succeeded. */
  recovered?: boolean;
}

// Slice C (R2): a tool call in an error state during an active turn is
// presented as a neutral retry, not a scary failure -- it "asked", it
// didn't "fail" (Dan's framing). Same copy regardless of tool; the
// technical receipt (state, error text) stays available in the details.
export const TOOL_ACTIVITY_RECOVERING_LABEL = "Retrying…";

const FALLBACK_ACTIVITY: Omit<ToolActivityDescriptor, "technicalLabel"> = {
  pending: "Working",
  done: "Finished step",
  error: "Step failed",
  phase: "unknown",
};

export const TOOL_ACTIVITY_REGISTRY: Record<string, Omit<ToolActivityDescriptor, "technicalLabel">> = {
  getWeather: {
    pending: "Checking weather",
    done: "Checked weather",
    error: "Weather check failed",
    phase: "data_lookup",
  },
  getGitHubRepo: {
    pending: "Checking repository",
    done: "Checked repository",
    error: "Repository check failed",
    phase: "data_lookup",
  },
  getGitHubPullRequests: {
    pending: "Checking pull requests",
    done: "Checked pull requests",
    error: "Pull request check failed",
    phase: "data_lookup",
  },
  getCryptoPrice: {
    pending: "Checking market price",
    done: "Checked market price",
    error: "Market price check failed",
    phase: "data_lookup",
  },
  getCryptoPriceHistory: {
    pending: "Checking price history",
    done: "Checked price history",
    error: "Price history check failed",
    phase: "data_lookup",
  },
  getHackerNewsTop: {
    pending: "Finding top stories",
    done: "Found top stories",
    error: "Story lookup failed",
    phase: "web_lookup",
  },
  webSearch: {
    pending: "Searching the web",
    done: "Searched the web",
    error: "Web search failed",
    phase: "web_lookup",
  },
  listAvailableTools: {
    pending: "Checking capabilities",
    done: "Checked capabilities",
    error: "Capability check failed",
    phase: "capabilities",
  },
  searchSkillCatalog: {
    pending: "Finding the right workflow",
    done: "Found the workflow",
    error: "Workflow lookup failed",
    phase: "workflow_discovery",
  },
  learnSkill: {
    pending: "Reading setup instructions",
    done: "Read setup instructions",
    error: "Instruction read failed",
    phase: "workflow_instructions",
  },
  searchCommandCatalog: {
    pending: "Finding available actions",
    done: "Found available actions",
    error: "Action lookup failed",
    phase: "action_discovery",
  },
  learnCommand: {
    pending: "Checking required fields",
    done: "Checked required fields",
    error: "Field check failed",
    phase: "action_schema",
  },
  executeCommand: {
    pending: "Checking booking data",
    done: "Checked booking data",
    error: "Booking data check failed",
    phase: "safe_read",
  },
  commitCommand: {
    pending: "Applying approved change",
    done: "Applied approved change",
    error: "Approved change failed",
    phase: "trusted_write",
  },
  readActiveArtifactState: {
    pending: "Reading your draft",
    done: "Read your draft",
    error: "Draft read failed",
    phase: "draft_read",
  },
  previewActiveIntakeCommand: {
    pending: "Preparing approval preview",
    done: "Prepared approval preview",
    error: "Approval preview failed",
    phase: "approval_preview",
  },
  previewBookingReservationCommand: {
    pending: "Preparing reservation preview",
    done: "Prepared reservation preview",
    error: "Reservation preview failed",
    phase: "approval_preview",
  },
  commitActiveIntakeCommand: {
    pending: "Creating booking setup",
    done: "Created booking setup",
    error: "Booking setup failed",
    phase: "trusted_write",
  },
  commitBookingReservationCommand: {
    pending: "Booking reservation",
    done: "Booked reservation",
    error: "Reservation booking failed",
    phase: "trusted_write",
  },
  createJsonArtifact: {
    pending: "Creating canvas",
    done: "Created canvas",
    error: "Canvas creation failed",
    phase: "canvas",
  },
  createBookingIntakeArtifact: {
    pending: "Opening setup canvas",
    done: "Opened setup canvas",
    error: "Setup canvas failed",
    phase: "canvas",
  },
  createDocumentArtifact: {
    pending: "Creating document",
    done: "Created document",
    error: "Document creation failed",
    phase: "document",
  },
  createDocument: {
    pending: "Creating document",
    done: "Created document",
    error: "Document creation failed",
    phase: "document",
  },
  updateDocumentArtifact: {
    pending: "Updating document",
    done: "Updated document",
    error: "Document update failed",
    phase: "document",
  },
  updateDocument: {
    pending: "Updating document",
    done: "Updated document",
    error: "Document update failed",
    phase: "document",
  },
  readActiveDocument: {
    pending: "Reading document",
    done: "Read document",
    error: "Document read failed",
    phase: "document",
  },
  readDocumentArtifact: {
    pending: "Reading document",
    done: "Read document",
    error: "Document read failed",
    phase: "document",
  },
  readDocument: {
    pending: "Reading document",
    done: "Read document",
    error: "Document read failed",
    phase: "document",
  },
};

export function normalizeToolName(toolNameOrPartType: string): string {
  return toolNameOrPartType.replace(/^tool-/, "");
}

export function isToolActivityLoading(state: string | null | undefined): boolean {
  return state !== "output-available" && state !== "output-error" && state !== "output-denied";
}

export function isToolActivityError(state: string | null | undefined): boolean {
  return state === "output-error" || state === "output-denied";
}

export function resolveToolActivity(
  toolNameOrPartType: string,
  state: string | null | undefined,
  labelOverrides: ToolActivityLabelOverrides = {},
  options: ToolActivityOptions = {},
): ToolActivityPresentation {
  const toolName = normalizeToolName(toolNameOrPartType);
  const registryDescriptor = TOOL_ACTIVITY_REGISTRY[toolName] ?? FALLBACK_ACTIVITY;
  const override = labelOverrides[toolName];
  const descriptor: ToolActivityDescriptor = {
    ...registryDescriptor,
    pending: override?.pending ?? registryDescriptor.pending,
    done: override?.done ?? registryDescriptor.done,
    error: override?.error ?? registryDescriptor.error,
    technicalLabel: toolName,
  };
  const rawError = isToolActivityError(state);
  const rawLoading = isToolActivityLoading(state);
  // Slice C: an error is only a user-facing failure once the turn has ended
  // without recovering. While the turn is still streaming, or once a later
  // call for the same tool succeeded, present it as a neutral retry instead.
  const isRecovering = rawError && (options.isTurnStreaming === true || options.recovered === true);
  const isError = rawError && !isRecovering;
  const isLoading = rawLoading || isRecovering;
  const label = isError
    ? descriptor.error
    : isRecovering
      ? TOOL_ACTIVITY_RECOVERING_LABEL
      : rawLoading
        ? descriptor.pending
        : descriptor.done;
  return { ...descriptor, label, isLoading, isError };
}

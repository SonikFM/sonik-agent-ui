export type ApprovalDisabledCode =
  | "streaming"
  | "trusted_host_approval_required"
  | "required_questions_unanswered"
  | "missing_active_artifact"
  | "approval_not_ready";

export interface ApprovalDisabledState {
  code: ApprovalDisabledCode;
  message: string;
}

const APPROVAL_DISABLED_MESSAGES: Record<ApprovalDisabledCode, string> = {
  streaming: "Wait for the current response to finish before using approval actions.",
  trusted_host_approval_required: "A trusted host approval is required before using approval actions.",
  required_questions_unanswered: "Answer the required questions before using approval actions.",
  missing_active_artifact: "Open an active draft before using approval actions.",
  approval_not_ready: "Approval actions are not ready yet.",
};

const MACHINE_REASON_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

export function resolveApprovalDisabledState(input: {
  isStreaming: boolean;
  disabled: boolean;
  reason?: string | null;
}): ApprovalDisabledState | null {
  if (input.isStreaming) {
    return { code: "streaming", message: APPROVAL_DISABLED_MESSAGES.streaming };
  }
  if (!input.disabled) return null;

  const reason = input.reason?.trim();
  if (reason && Object.prototype.hasOwnProperty.call(APPROVAL_DISABLED_MESSAGES, reason)) {
    const code = reason as ApprovalDisabledCode;
    return { code, message: APPROVAL_DISABLED_MESSAGES[code] };
  }
  if (reason && !MACHINE_REASON_PATTERN.test(reason)) {
    return { code: "approval_not_ready", message: reason };
  }
  return { code: "approval_not_ready", message: APPROVAL_DISABLED_MESSAGES.approval_not_ready };
}

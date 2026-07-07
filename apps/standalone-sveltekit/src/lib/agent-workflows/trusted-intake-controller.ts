export type TrustedIntakeControllerAction =
  | "saveDraft"
  | "editDraft"
  | "submitToAgent"
  | "reviseWithAgent"
  | "requestApproval"
  | "cancelApproval"
  | "approveAndRun";

export type TrustedIntakeApprovalReadiness = {
  ready: boolean;
  visible: boolean;
  reason: string | null;
};

export type TrustedIntakeControllerDecision = {
  ok: boolean;
  code: "accepted" | "not_booking_intake" | "approval_not_ready";
  commandId: "booking.create.context";
  reason: string | null;
};

const trustedIntakeControllerActions = new Set<string>([
  "saveDraft",
  "editDraft",
  "submitToAgent",
  "reviseWithAgent",
  "requestApproval",
  "cancelApproval",
  "approveAndRun",
]);

const approvalActions = new Set<TrustedIntakeControllerAction>(["requestApproval", "approveAndRun"]);

export function isTrustedIntakeControllerAction(actionName: string): actionName is TrustedIntakeControllerAction {
  return trustedIntakeControllerActions.has(actionName);
}

export function decideTrustedIntakeControllerAction(input: {
  actionName: TrustedIntakeControllerAction;
  isBookingIntakeArtifact: boolean;
  readiness: TrustedIntakeApprovalReadiness;
}): TrustedIntakeControllerDecision {
  if (!input.isBookingIntakeArtifact) {
    return {
      ok: false,
      code: "not_booking_intake",
      commandId: "booking.create.context",
      reason: "Open a booking intake draft before running setup actions.",
    };
  }

  if (approvalActions.has(input.actionName) && !input.readiness.ready) {
    return {
      ok: false,
      code: "approval_not_ready",
      commandId: "booking.create.context",
      reason: input.readiness.reason ?? "Complete the required intake fields before requesting approval.",
    };
  }

  return { ok: true, code: "accepted", commandId: "booking.create.context", reason: null };
}

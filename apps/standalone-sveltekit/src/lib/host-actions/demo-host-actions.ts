import { createUnavailableAgentHostActionResult } from "@sonik-agent-ui/agent-embed";
import { createHostActionResult, type HostActionRequest, type HostActionResult } from "@sonik-agent-ui/tool-contracts/target-registry";

export type DemoDocumentElementLike = { setAttribute(name: string, value: string): void };
export type DemoDocumentLike = { querySelector(selector: string): DemoDocumentElementLike | null };
export type DemoHostActionHandler = (request: HostActionRequest) => Promise<HostActionResult>;

// ponytail: reference implementation for the standalone demo host only —
// implements just enough of the allowlist (tour.highlight) to prove the seam;
// every other action key fails closed via the shared unavailable-result helper.
export function createDemoHostActionHandler({ documentLike }: { documentLike: DemoDocumentLike }): DemoHostActionHandler {
  return async (request) => {
    if (request.actionKey === "tour.highlight" && request.targetId) {
      const element = documentLike.querySelector(`[data-sonik-target="${request.targetId}"]`);
      if (element) {
        element.setAttribute("data-sonik-highlighted", "true");
        return createHostActionResult({
          requestId: request.requestId,
          actionKey: request.actionKey,
          ok: true,
          status: "executed",
          policyMode: "allow",
          message: "Demo host action executed.",
        });
      }
      return createUnavailableAgentHostActionResult({
        requestId: request.requestId,
        actionKey: request.actionKey,
        disabledReason: "host_action_target_not_found",
      });
    }
    return createUnavailableAgentHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      disabledReason: "host_action_handler_not_registered",
    });
  };
}

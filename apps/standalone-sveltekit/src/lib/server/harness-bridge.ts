// R3 (.omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md) + E3: server-side,
// topology-independent harness chat bridge. Dev-agent text appended via send()
// is INPUT ONLY -- it carries no approval semantics and is never read by
// evaluateHostActionRequest (packages/tool-contracts/src/target-registry.ts).
import { createRequestId, sanitizePersistenceValue } from "@sonik-agent-ui/agent-observability";

export interface HarnessBridgeSessionStore {
  appendMessage(input: { session_id: string; id?: string; role: string; content?: string | null; parts?: unknown }): unknown | Promise<unknown>;
  listMessages(sessionId: string): unknown[] | Promise<unknown[]>;
}

export interface HarnessBridgeSendReceipt {
  ok: boolean;
  status: "executed" | "blocked";
  receiptId?: string;
  reason?: string;
}

// Turns are metadata-only, no free-form message text. sanitizePersistenceValue
// (reused below) only recognizes known secret shapes (vck_/sk-/Bearer, 12+
// chars); it cannot prove arbitrary dev-agent prose is secret-free, and this
// bridge does not add a new secret-detection regex on top of it. Structural
// fields carry no such risk, so they're the only thing read() exposes.
// ponytail: no raw/redacted transcript text in read() output. Add a real
// free-text secret scanner (or a trusted allowlist) before exposing it.
export interface HarnessBridgeTurn {
  id: string;
  role: string;
  provenance: string | null;
  createdAt: string | null;
}

export function createHarnessBridge(input: { sessionStore: HarnessBridgeSessionStore; isEnabled: boolean | (() => boolean) }) {
  const { sessionStore, isEnabled } = input;
  const enabled = () => (typeof isEnabled === "function" ? isEnabled() : isEnabled);

  return {
    async send({ sessionId, text, attachments }: { sessionId: string; text: string; attachments?: unknown }): Promise<HarnessBridgeSendReceipt> {
      if (!enabled()) {
        return { ok: false, status: "blocked", reason: "harness bridge is disabled" };
      }
      await sessionStore.appendMessage({
        session_id: sessionId,
        role: "assistant",
        content: text,
        parts: { provenance: "dev-agent", text, ...(attachments !== undefined ? { attachments } : {}) },
      });
      return { ok: true, status: "executed", receiptId: createRequestId("harness-receipt") };
    },

    async read({ sessionId, sinceId, limit }: { sessionId: string; sinceId?: string; limit: number }): Promise<{ turns: HarnessBridgeTurn[] }> {
      const messages = (await sessionStore.listMessages(sessionId)) as Array<Record<string, unknown>>;
      const sinceIndex = sinceId ? messages.findIndex((message) => message.id === sinceId) : -1;
      const scoped = sinceIndex >= 0 ? messages.slice(sinceIndex + 1) : messages;
      const bounded = scoped.slice(-Math.max(0, limit));
      const turns: HarnessBridgeTurn[] = bounded.map((message) => {
        const parts = (message.parts ?? null) as Record<string, unknown> | null;
        return sanitizePersistenceValue({
          id: String(message.id),
          role: String(message.role),
          provenance: typeof parts?.provenance === "string" ? parts.provenance : null,
          createdAt: typeof message.created_at === "string" ? message.created_at : null,
        }) as HarnessBridgeTurn;
      });
      return { turns };
    },
  };
}

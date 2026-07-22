import { sanitizePersistenceValue } from "@sonik-agent-ui/agent-observability";
import type { ObservationCapture } from "./observation-capture.ts";

const TOTAL_BUDGET_BYTES = 65536;

export type BugReportPageContext = Record<string, unknown>;

export type BugReportScreenshotRef = {
  mediaType: string;
  data: string;
};

export type BugReport = {
  kind: "bug-report";
  createdAt: string;
  console: { entries: unknown[]; droppedCount: number };
  network: { entries: unknown[]; droppedCount: number };
  pageContext: BugReportPageContext;
  screenshotRef?: BugReportScreenshotRef;
};

function createReceiptId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function assembleBugReport({
  capture,
  pageContext,
  screenshotRef,
}: {
  capture: ObservationCapture;
  pageContext: BugReportPageContext;
  screenshotRef?: BugReportScreenshotRef;
}): BugReport {
  const consoleResult = capture.readConsole();
  const networkResult = capture.readNetwork();

  const report: BugReport = {
    kind: "bug-report",
    createdAt: new Date().toISOString(),
    console: { entries: [...consoleResult.entries], droppedCount: consoleResult.droppedCount },
    network: { entries: [...networkResult.entries], droppedCount: networkResult.droppedCount },
    pageContext: sanitizePersistenceValue(pageContext) as BugReportPageContext,
    screenshotRef,
  };

  // Trim oldest observation entries (never pageContext/screenshotRef) until
  // the whole report fits the 64KB budget, folding each trim into droppedCount.
  while (
    byteLength(report) > TOTAL_BUDGET_BYTES &&
    (report.console.entries.length > 0 || report.network.entries.length > 0)
  ) {
    const trimTarget = report.console.entries.length >= report.network.entries.length ? report.console : report.network;
    trimTarget.entries.shift();
    trimTarget.droppedCount += 1;
  }

  return report;
}

export type ConversationFilePart = {
  type: "file";
  mediaType: string;
  data: string;
};

export type ConversationMessage = {
  role: "assistant";
  parts: ConversationFilePart[];
};

export type Conversation = {
  messages: ConversationMessage[];
};

export type AttachmentReceipt = {
  receiptId: string;
};

export async function attachToConversation({
  conversation,
  attachment,
}: {
  conversation: Conversation;
  attachment: BugReportScreenshotRef;
}): Promise<AttachmentReceipt> {
  conversation.messages.push({
    role: "assistant",
    parts: [{ type: "file", mediaType: attachment.mediaType, data: attachment.data }],
  });
  return { receiptId: createReceiptId("attach") };
}

export type BlockedReceipt = { ok: false; status: "blocked"; reason: string };

export type PauseSwitch = {
  pause(): void;
  resume(): void;
  guard<Args extends unknown[], Result>(
    commandFn: (...args: Args) => Result | Promise<Result>,
  ): (...args: Args) => Promise<Result | BlockedReceipt>;
};

export function createPauseSwitch(): PauseSwitch {
  let paused = false;

  return {
    pause(): void {
      paused = true;
    },
    resume(): void {
      paused = false;
    },
    guard(commandFn) {
      return async (...args) => {
        if (paused) {
          return { ok: false, status: "blocked", reason: "commands are paused" };
        }
        return commandFn(...args);
      };
    },
  };
}

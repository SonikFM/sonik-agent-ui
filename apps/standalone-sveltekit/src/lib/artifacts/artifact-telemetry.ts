import type { Spec } from "@json-render/core";

export type ArtifactTelemetrySource = "server" | "client";

export interface ArtifactTelemetryEvent {
  source: ArtifactTelemetrySource;
  event: string;
  requestId?: string;
  runId?: string;
  sessionId?: string;
  artifactId?: string;
  artifactVersion?: number;
  documentId?: string;
  documentVersion?: number;
  title?: string;
  root?: string;
  elementCount?: number;
  totalMatches?: number;
  surface?: string;
  route?: string;
  commandFamilies?: string[];
  skillFamilies?: string[];
  pageContext?: unknown;
  runtimeStatus?: string;
  reason?: string;
  mode?: string;
  durationMs?: number;
  messageId?: string;
  toolCallId?: string;
  ok?: boolean;
  error?: string;
  at?: string;
}

const PREFIX = "[sonik-agent-ui]";

export function logArtifactTelemetry(event: ArtifactTelemetryEvent): void {
  const payload = sanitizeTelemetryEvent({ runId: resolveBrowserTelemetryRunId(), ...event, at: new Date().toISOString() });
  const line = `${PREFIX} ${JSON.stringify(payload)}`;

  if (payload.ok === false || payload.error) {
    console.warn(line);
  } else {
    console.info(line);
  }

  postBrowserTelemetry(payload);
}

export function summarizeSpec(spec: Spec): Pick<ArtifactTelemetryEvent, "root" | "elementCount"> {
  return {
    root: spec.root,
    elementCount: Object.keys(spec.elements).length,
  };
}

function resolveBrowserTelemetryRunId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = new URLSearchParams(window.location.search).get("smokeRunId");
    return value && /^[A-Za-z0-9_.:-]{6,160}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function postBrowserTelemetry(event: ArtifactTelemetryEvent): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ event });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon("/api/telemetry", new Blob([body], { type: "application/json" }));
      if (sent) return;
    }
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Telemetry must never affect the artifact UX.
  }
}

function sanitizeTelemetryEvent(event: ArtifactTelemetryEvent): ArtifactTelemetryEvent {
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined && value !== ""),
  ) as ArtifactTelemetryEvent;
}

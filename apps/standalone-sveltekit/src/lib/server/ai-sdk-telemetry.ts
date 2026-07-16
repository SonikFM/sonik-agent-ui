import { OpenTelemetry, type OpenTelemetryOptions, type OpenTelemetrySpanType } from "@ai-sdk/otel";
import { registerTelemetry, type TelemetryOptions } from "ai";
import { emitAgentTelemetrySync } from "./agent-telemetry.ts";

export const AI_SDK_TELEMETRY_FUNCTION = {
  main: "agent.main",
  search: "agent.search",
  draftWorkflow: "agent.draft_workflow",
} as const;

export interface AiSdkTelemetryCorrelation {
  requestId: string;
  traceId: string;
  traceparent: string;
  sessionId?: string;
  runId?: string;
  workflowRunId?: string;
}

export type AiSdkTelemetryRuntimeContext = Partial<AiSdkTelemetryCorrelation> & {
  functionId: (typeof AI_SDK_TELEMETRY_FUNCTION)[keyof typeof AI_SDK_TELEMETRY_FUNCTION];
};

const REGISTERED = Symbol.for("sonik.agent-ui.ai-sdk-telemetry.registered.v1");
const SAFE_ATTRIBUTE_KEYS = new Set([
  "sonik.function_id",
  "sonik.operation_id",
  "sonik.request_id",
  "sonik.run_id",
  "sonik.session_id",
  "sonik.span_type",
  "sonik.trace_id",
  "sonik.traceparent",
  "sonik.workflow_run_id",
]);
const SPAN_TYPES = new Set<OpenTelemetrySpanType>(["operation", "step", "languageModel", "tool", "embedding", "reranking"]);
const OPERATIONS = new Set(["ai.embed", "ai.embedMany", "ai.generateObject", "ai.generateText", "ai.rerank", "ai.streamObject", "ai.streamText"]);
const FUNCTIONS = new Set(Object.values(AI_SDK_TELEMETRY_FUNCTION));

export function createAiSdkTelemetryRuntimeContext(
  correlation: Partial<AiSdkTelemetryCorrelation> | undefined,
  functionId: AiSdkTelemetryRuntimeContext["functionId"],
): AiSdkTelemetryRuntimeContext {
  return sanitizeRuntimeContext({ ...correlation, functionId });
}

export function createAiSdkTelemetryOptions(
  functionId: AiSdkTelemetryRuntimeContext["functionId"],
  isEnabled = true,
): TelemetryOptions<AiSdkTelemetryRuntimeContext> {
  return {
    isEnabled,
    recordInputs: false,
    recordOutputs: false,
    functionId,
    includeRuntimeContext: {
      functionId: true,
      requestId: true,
      traceId: true,
      traceparent: true,
      sessionId: true,
      runId: true,
      workflowRunId: true,
    },
  };
}

export function registerAiSdkTelemetry(): boolean {
  const state = globalThis as typeof globalThis & { [REGISTERED]?: boolean };
  if (state[REGISTERED]) return false;
  try {
    registerTelemetry(new OpenTelemetry({
      tracer: createAiSdkTelemetryTracer(),
      enrichSpan: ({ spanType, operationId, runtimeContext }) => ({
        "sonik.span_type": SPAN_TYPES.has(spanType) ? spanType : "operation",
        "sonik.operation_id": OPERATIONS.has(operationId) ? operationId : "ai.unknown",
        ...toSafeAttributes(runtimeContext),
      }),
      usage: false,
      providerMetadata: false,
      embedding: false,
      reranking: false,
      runtimeContext: false,
      headers: false,
      toolChoice: false,
      schema: false,
    }));
  } catch {
    return false;
  }
  state[REGISTERED] = true;
  return true;
}

export function createAiSdkTelemetryTracer(): NonNullable<OpenTelemetryOptions["tracer"]> {
  const startSpan = (_name: unknown, options?: { attributes?: Record<string, unknown> }) => {
    const startedAt = performance.now();
    const attributes = selectSafeAttributes(options?.attributes);
    const candidateTraceId = readString(attributes["sonik.trace_id"]);
    const spanTraceId = candidateTraceId && isTraceId(candidateTraceId) ? candidateTraceId : randomHex(16);
    const spanId = randomHex(8);
    let ended = false;
    let statusCode = 0;
    const span = {
      spanContext: () => ({ traceId: spanTraceId, spanId, traceFlags: 1 }),
      setAttribute(key: string, value: unknown) {
        if (SAFE_ATTRIBUTE_KEYS.has(key) && typeof value === "string") attributes[key] = value;
        return span;
      },
      setAttributes(values: Record<string, unknown>) {
        Object.assign(attributes, selectSafeAttributes(values));
        return span;
      },
      addEvent() { return span; },
      addLink() { return span; },
      addLinks() { return span; },
      setStatus(status: { code?: number }) {
        statusCode = typeof status?.code === "number" ? status.code : statusCode;
        return span;
      },
      updateName() { return span; },
      end() {
        if (ended) return;
        ended = true;
        const runtime = attributesToRuntimeContext(attributes);
        const spanType = readString(attributes["sonik.span_type"]);
        const operationId = readString(attributes["sonik.operation_id"]);
        emitAgentTelemetrySync({
          source: "server",
          event: "ai.sdk.span.end",
          requestId: runtime.requestId,
          traceId: runtime.traceId,
          traceparent: runtime.traceparent,
          sessionId: runtime.sessionId,
          runId: runtime.runId,
          workflowRunId: runtime.workflowRunId,
          durationMs: Math.max(0, performance.now() - startedAt),
          ok: statusCode !== 2,
          payload: {
            type: runtime.functionId ?? "agent.unknown",
            kind: SPAN_TYPES.has(spanType as OpenTelemetrySpanType) ? spanType : "operation",
            operationId: operationId && OPERATIONS.has(operationId) ? operationId : "ai.unknown",
            status: statusCode === 2 ? "error" : "ok",
          },
        });
      },
      isRecording: () => !ended,
      recordException() { return span; },
    };
    return span;
  };

  return {
    startSpan,
    startActiveSpan(_name: unknown, ...args: unknown[]) {
      const callback = [...args].reverse().find((value): value is (span: ReturnType<typeof startSpan>) => unknown => typeof value === "function");
      if (!callback) return undefined as never;
      const options = args.find((value) => value && typeof value === "object" && "attributes" in value) as { attributes?: Record<string, unknown> } | undefined;
      return callback(startSpan(_name, options)) as never;
    },
  } as NonNullable<OpenTelemetryOptions["tracer"]>;
}

function sanitizeRuntimeContext(value: Record<string, unknown>): AiSdkTelemetryRuntimeContext {
  const functionId = FUNCTIONS.has(value.functionId as never)
    ? value.functionId as AiSdkTelemetryRuntimeContext["functionId"]
    : AI_SDK_TELEMETRY_FUNCTION.main;
  const explicitTraceId = typeof value.traceId === "string" && isTraceId(value.traceId)
    ? value.traceId.toLowerCase()
    : undefined;
  const candidateTraceparent = typeof value.traceparent === "string" && /^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/i.test(value.traceparent)
    ? value.traceparent.toLowerCase()
    : undefined;
  const traceparentTraceId = candidateTraceparent?.split("-")[1];
  const traceId = explicitTraceId ?? traceparentTraceId;
  const traceparent = candidateTraceparent && (!explicitTraceId || explicitTraceId === traceparentTraceId)
    ? candidateTraceparent
    : undefined;
  return {
    functionId,
    ...(safeId(value.requestId) ? { requestId: safeId(value.requestId) } : {}),
    ...(traceId ? { traceId } : {}),
    ...(traceparent ? { traceparent } : {}),
    ...(safeId(value.sessionId) ? { sessionId: safeId(value.sessionId) } : {}),
    ...(safeId(value.runId) ? { runId: safeId(value.runId) } : {}),
    ...(safeId(value.workflowRunId) ? { workflowRunId: safeId(value.workflowRunId) } : {}),
  };
}

function toSafeAttributes(value: Record<string, unknown> | undefined): Record<string, string> {
  const runtime = sanitizeRuntimeContext(value ?? {});
  return {
    "sonik.function_id": runtime.functionId,
    ...(runtime.requestId ? { "sonik.request_id": runtime.requestId } : {}),
    ...(runtime.traceId ? { "sonik.trace_id": runtime.traceId } : {}),
    ...(runtime.traceparent ? { "sonik.traceparent": runtime.traceparent } : {}),
    ...(runtime.sessionId ? { "sonik.session_id": runtime.sessionId } : {}),
    ...(runtime.runId ? { "sonik.run_id": runtime.runId } : {}),
    ...(runtime.workflowRunId ? { "sonik.workflow_run_id": runtime.workflowRunId } : {}),
  };
}

function selectSafeAttributes(value: Record<string, unknown> | undefined): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const key of SAFE_ATTRIBUTE_KEYS) {
    const descriptor = value ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string") selected[key] = descriptor.value;
  }
  return selected;
}

function attributesToRuntimeContext(attributes: Record<string, string>): AiSdkTelemetryRuntimeContext {
  return sanitizeRuntimeContext({
    functionId: attributes["sonik.function_id"],
    requestId: attributes["sonik.request_id"],
    traceId: attributes["sonik.trace_id"],
    traceparent: attributes["sonik.traceparent"],
    sessionId: attributes["sonik.session_id"],
    runId: attributes["sonik.run_id"],
    workflowRunId: attributes["sonik.workflow_run_id"],
  });
}

function safeId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isTraceId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value) && !/^0+$/.test(value);
}

function randomHex(bytesLength: number): string {
  const bytes = new Uint8Array(bytesLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

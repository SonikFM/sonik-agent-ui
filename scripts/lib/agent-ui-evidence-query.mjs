import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

export const FILTER_FIELDS = ["requestId", "traceId", "sessionId", "event", "runId", "source"];
export const CORRELATION_FIELDS = [
  "requestId",
  "traceId",
  "traceparent",
  "sessionId",
  "runId",
  "eventId",
  "messageId",
  "artifactId",
  "toolCallId",
  "documentId",
];

const TELEMETRY_MESSAGE_TAG = "sonik_agent_ui_telemetry";

export function parseJsonlEvents(text, { source = "dev-server" } = {}) {
  const input = String(text ?? "");
  const trimmed = input.trim();
  if (trimmed) {
    try {
      return normalizeEvidenceValue(JSON.parse(trimmed));
    } catch {
      // Multiple JSONL records or a malformed line are handled below.
    }
  }

  return input
    .split("\n")
    .filter(Boolean)
    .flatMap((line, index) => {
      try {
        return normalizeEvidenceValue(JSON.parse(line));
      } catch (error) {
        return [{
          source,
          event: "telemetry.parse_error",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          line: index + 1,
        }];
      }
    });
}

export async function readEvidenceEventsFromFile(logPath, options) {
  if (!existsSync(logPath)) return [];
  const text = await readFile(logPath, "utf8").catch(() => "");
  return parseJsonlEvents(text, options);
}

export function queryEvents(events, query = {}) {
  const limit = normalizeLimit(query.limit);
  const cursor = normalizeCursor(query.cursor);
  const sinceTime = parseOptionalIsoTime(query.since, "since");
  const untilTime = parseOptionalIsoTime(query.until, "until");

  const filtered = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => {
      if (!matchesExactFilters(event, query)) return false;
      if (!matchesCorrelationId(event, query.correlationId)) return false;
      if (!matchesTimeWindow(event, sinceTime, untilTime)) return false;
      return true;
    })
    .sort((left, right) => compareEventsByAtThenIndex(left, right))
    .map(({ event }) => event);

  const page = filtered.slice(cursor, cursor + limit);
  const nextOffset = cursor + page.length;
  return {
    events: page,
    nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
  };
}

export function queryEventsFromSearchParams(events, searchParams) {
  return queryEvents(events, Object.fromEntries(searchParams.entries()));
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_LIMIT;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(numeric), MAX_LIMIT);
}

function normalizeCursor(value) {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.trunc(numeric);
}

function parseOptionalIsoTime(value, name) {
  if (value === undefined || value === null || value === "") return null;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) throw new Error(`invalid_${name}`);
  return time;
}

function compareEventsByAtThenIndex(left, right) {
  const leftTime = sortableEventTime(left.event);
  const rightTime = sortableEventTime(right.event);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.index - right.index;
}

function sortableEventTime(event) {
  const time = Date.parse(String(event?.at ?? ""));
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function matchesExactFilters(event, query) {
  return FILTER_FIELDS.every((key) => !hasQueryValue(query[key]) || String(event[key] ?? "") === String(query[key]));
}

function matchesCorrelationId(event, correlationId) {
  if (!hasQueryValue(correlationId)) return true;
  const expected = String(correlationId);
  return CORRELATION_FIELDS.some((field) => explicitFieldEquals(event, field, expected) || explicitFieldEquals(event?.payload, field, expected));
}

function explicitFieldEquals(value, field, expected) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, field)) return false;
  const actual = value[field];
  return actual !== undefined && actual !== null && String(actual) === expected;
}

function matchesTimeWindow(event, sinceTime, untilTime) {
  if (sinceTime === null && untilTime === null) return true;
  const time = Date.parse(String(event?.at ?? ""));
  if (!Number.isFinite(time)) return false;
  if (sinceTime !== null && time < sinceTime) return false;
  if (untilTime !== null && time > untilTime) return false;
  return true;
}

function hasQueryValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function normalizeEvidenceValue(value) {
  const tupleEvent = telemetryTupleEvent(value);
  if (tupleEvent) return [tupleEvent];
  if (!isPlainRecord(value)) return [value];
  if (Object.hasOwn(value, "event")) return [value];

  const payloadEvent = directPayloadEvent(value);
  if (payloadEvent) return [payloadEvent];
  const messageEvent = telemetryTupleEvent(value.message);
  if (messageEvent) return [messageEvent];

  const hasEvents = Array.isArray(value.events);
  const hasLogs = Array.isArray(value.logs);
  if (!hasEvents && !hasLogs) return [value];

  return [
    ...(hasEvents ? value.events.flatMap(normalizeEventContainerEntry) : []),
    ...(hasLogs ? value.logs.flatMap(normalizeLogEntry) : []),
  ];
}

function normalizeEventContainerEntry(value) {
  const tupleEvent = telemetryTupleEvent(value);
  if (tupleEvent) return [tupleEvent];
  if (!isPlainRecord(value)) return [];
  if (Object.hasOwn(value, "event")) return [value];

  const payloadEvent = directPayloadEvent(value);
  if (payloadEvent) return [payloadEvent];
  const messageEvent = telemetryTupleEvent(value.message);
  if (messageEvent) return [messageEvent];
  if (Array.isArray(value.logs)) return value.logs.flatMap(normalizeLogEntry);
  return [];
}

function normalizeLogEntry(value) {
  const tupleEvent = telemetryTupleEvent(value);
  if (tupleEvent) return [tupleEvent];
  if (!isPlainRecord(value)) return [];
  if (Object.hasOwn(value, "event")) return [value];

  const payloadEvent = directPayloadEvent(value);
  if (payloadEvent) return [payloadEvent];
  const messageEvent = telemetryTupleEvent(value.message);
  return messageEvent ? [messageEvent] : [];
}

function directPayloadEvent(value) {
  if (!isPlainRecord(value?.payload) || !Object.hasOwn(value.payload, "event")) return null;
  return value.payload;
}

function telemetryTupleEvent(value) {
  if (!Array.isArray(value) || value[0] !== TELEMETRY_MESSAGE_TAG) return null;
  return directPayloadEvent(value[1]);
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

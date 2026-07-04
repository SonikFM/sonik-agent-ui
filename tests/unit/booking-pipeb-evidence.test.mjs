import assert from 'node:assert/strict';
import { extractPipeBToolEvents, hasTelemetryEvent, hasEventName, countRelevantPipeBLines } from '../../scripts/lib/booking-pipeb-evidence.mjs';

const matchingRecord = JSON.stringify({
  objectKey: 'workers/sonik-agent-ui/current-run.json',
  request: { url: '/api/generate?smokeRunId=run-123', body: { prompt: 'clientRequestId agent-ui-smoke-reservation-run-123' } },
  logs: [
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'api.generate.start', ok: true, sessionId: 'workspace-session-current' } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.searchSkillCatalog', ok: true, query: 'booking.reservation.create' } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'booking.runtime.fetch.end', ok: true, toolCallId: 'booking.create.booking' } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.commitCommand', ok: true, toolCallId: 'booking.create.booking' } }] },
  ],
});

const unrelatedRecord = JSON.stringify({
  objectKey: 'workers/sonik-agent-ui/other-run.json',
  request: { url: '/api/generate?smokeRunId=other-run' },
  logs: [
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.searchSkillCatalog', ok: true, query: 'booking.reservation.create' } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'booking.runtime.fetch.end', ok: true, toolCallId: 'booking.create.booking' } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.commitCommand', ok: true, toolCallId: 'booking.create.booking' } }] },
  ],
});


const sameRequestWithoutGenerateAnchor = JSON.stringify({
  request: { url: '/api/generate?smokeRunId=run-123', body: { prompt: 'clientRequestId agent-ui-smoke-reservation-run-123' } },
  logs: [
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.commitCommand', ok: true, toolCallId: 'booking.create.booking', note: 'unanchored same-record telemetry must not prove this smoke' } }] },
  ],
});


const sameObjectNestedUnrelatedRecord = JSON.stringify({
  request: { path: '/api/generate', url: '/api/generate?smokeRunId=run-123' },
  logs: [{ message: ['sonik_agent_ui_telemetry', { payload: { event: 'api.generate.start', ok: true, sessionId: 'workspace-session-current' } }] }],
  unrelated: {
    logs: [{ message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.commitCommand', ok: true, toolCallId: 'booking.create.booking' } }] }],
  },
});

const sameObjectMixedLogUnrelatedRecord = JSON.stringify({
  request: { path: '/api/generate', url: '/api/generate?smokeRunId=run-123' },
  logs: [
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'api.generate.start', ok: true, sessionId: 'workspace-session-current' } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.commitCommand', ok: true, toolCallId: 'booking.create.booking', runId: 'other-run' } }] },
  ],
});

const redactedSessionRecord = JSON.stringify({
  request: { path: '/api/generate', url: '/api/generate?smokeRunId=run-123' },
  logs: [
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'api.generate.start', ok: true, sessionId: '[redacted]' } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.commitCommand', ok: true, toolCallId: 'booking.create.booking', sessionId: '[redacted]' } }] },
  ],
});

const staleSameWindowRecord = JSON.stringify({
  request: { path: '/api/generate', url: '/api/generate?smokeRunId=other-run', body: { prompt: 'Check availability from 2026-07-08T18:00:00.000Z to 2026-07-08T19:00:00.000Z' } },
  logs: [
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'api.generate.start', ok: true } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'booking.runtime.fetch.end', ok: true, toolCallId: 'booking.create.booking' } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.commitCommand', ok: true, toolCallId: 'booking.create.booking' } }] },
  ],
});

const mixedBatchRecord = JSON.stringify({
  kind: 'normalized_tail_batch',
  events: [
    {
      request: { path: '/api/generate', url: '/api/generate?smokeRunId=run-123' },
      logs: [{ message: ['sonik_agent_ui_telemetry', { payload: { event: 'api.generate.start', ok: true, sessionId: 'workspace-session-current' } }] }],
    },
    {
      request: { path: '/api/generate', url: '/api/generate?smokeRunId=other-run' },
      logs: [{ message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.commitCommand', ok: true, toolCallId: 'booking.create.booking' } }] }],
    },
  ],
});

const unrelatedSearchRecord = JSON.stringify({
  objectKey: 'workers/sonik-agent-ui/current-run-unrelated-search.json',
  request: { url: '/api/generate?smokeRunId=run-123' },
  logs: [
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'api.generate.start', ok: true, sessionId: 'workspace-session-current' } }] },
    { message: ['sonik_agent_ui_telemetry', { payload: { event: 'tool.searchSkillCatalog', ok: true, query: 'weather.dashboard' } }] },
  ],
});

const correlated = extractPipeBToolEvents(`${unrelatedRecord}\n${matchingRecord}`, { markers: ['run-123'] });
assert.equal(correlated.some((line) => line.includes('other-run')), false, 'correlated extraction must not accept unrelated run telemetry');
assert.equal(hasTelemetryEvent(correlated, 'booking.reservation.create', 'tool.searchSkillCatalog', true), true, 'matching run skill search is detected');
assert.equal(hasTelemetryEvent(correlated, 'booking.create.booking', 'booking.runtime.fetch.end', true), true, 'matching run booking runtime receipt is detected');
assert.equal(hasTelemetryEvent(correlated, 'booking.create.booking', 'tool.commitCommand', true), true, 'matching run booking commit receipt is detected');
assert.equal(hasEventName(correlated, 'tool.searchSkillCatalog', true), true, 'event-name helper still works on correlated records');

const unrelatedOnly = extractPipeBToolEvents(unrelatedRecord, { markers: ['run-123'] });
assert.equal(unrelatedOnly.length, 0, 'unrelated successful tool calls must not satisfy a smoke run');

const unanchoredSameRequest = extractPipeBToolEvents(sameRequestWithoutGenerateAnchor, { markers: ['run-123', 'workspace-session-current', 'agent-ui-smoke-reservation-run-123'] });
assert.equal(hasTelemetryEvent(unanchoredSameRequest, 'booking.create.booking', 'tool.commitCommand', true), false, 'a marker-bearing record without an api.generate anchor must not donate booking commits');

const mixedBatch = extractPipeBToolEvents(mixedBatchRecord, { markers: ['run-123', 'workspace-session-current'] });
assert.equal(hasTelemetryEvent(mixedBatch, 'booking.create.booking', 'tool.commitCommand', true), false, 'a normalized batch marker must not admit unrelated event objects in the same batch');

const sameObjectNestedUnrelated = extractPipeBToolEvents(sameObjectNestedUnrelatedRecord, { markers: ['run-123', 'workspace-session-current'] });
assert.equal(hasTelemetryEvent(sameObjectNestedUnrelated, 'booking.create.booking', 'tool.commitCommand', true), false, 'a correlated top-level generate record must not donate relevant telemetry from unrelated nested siblings');

const sameObjectMixedLogUnrelated = extractPipeBToolEvents(sameObjectMixedLogUnrelatedRecord, { markers: ['run-123', 'workspace-session-current'] });
assert.equal(hasTelemetryEvent(sameObjectMixedLogUnrelated, 'booking.create.booking', 'tool.commitCommand', true), false, 'a correlated top-level generate record must not donate logs with explicit conflicting run ids');

const redactedSession = extractPipeBToolEvents(redactedSessionRecord, { markers: ['run-123', 'workspace-session-current'] });
assert.equal(hasTelemetryEvent(redactedSession, 'booking.create.booking', 'tool.commitCommand', true), true, 'redacted correlation values from Pipe-B must not block same-record direct logs');

const staleSameWindow = extractPipeBToolEvents(staleSameWindowRecord, { markers: ['current-run', 'workspace-session-current', 'client-current', '2026-07-08T18:00:00.000Z', '2026-07-08T19:00:00.000Z'] });
assert.equal(hasTelemetryEvent(staleSameWindow, 'booking.create.booking', 'tool.commitCommand', true), false, 'matching reservation time markers alone must not prove current-run booking commits');

const wrongSearch = extractPipeBToolEvents(unrelatedSearchRecord, { markers: ['run-123'] });
assert.equal(hasEventName(wrongSearch, 'tool.searchSkillCatalog', true), true, 'generic search event is present');
assert.equal(hasTelemetryEvent(wrongSearch, 'booking.context.create', 'tool.searchSkillCatalog', true), false, 'generic search must not satisfy booking context skill search proof');

assert.equal(countRelevantPipeBLines(`${unrelatedRecord}\n${matchingRecord}`, ['run-123']) > 0, true, 'correlated line count reports current-run evidence');
assert.equal(countRelevantPipeBLines(unrelatedRecord, ['run-123']), 0, 'correlated line count ignores unrelated runs');

console.log('booking-pipeb-evidence tests passed');

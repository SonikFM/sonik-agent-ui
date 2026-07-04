import assert from 'node:assert/strict';
import { extractPipeBToolEvents, hasTelemetryEvent, hasEventName, countRelevantPipeBLines } from '../../scripts/lib/booking-pipeb-evidence.mjs';

const matchingRecord = JSON.stringify({
  objectKey: 'workers/sonik-agent-ui/current-run.json',
  request: { url: '/api/generate?smokeRunId=run-123', body: { prompt: 'clientRequestId agent-ui-smoke-reservation-run-123' } },
  logs: [
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

const unrelatedSearchRecord = JSON.stringify({
  objectKey: 'workers/sonik-agent-ui/current-run-unrelated-search.json',
  request: { url: '/api/generate?smokeRunId=run-123' },
  logs: [
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

const wrongSearch = extractPipeBToolEvents(unrelatedSearchRecord, { markers: ['run-123'] });
assert.equal(hasEventName(wrongSearch, 'tool.searchSkillCatalog', true), true, 'generic search event is present');
assert.equal(hasTelemetryEvent(wrongSearch, 'booking.context.create', 'tool.searchSkillCatalog', true), false, 'generic search must not satisfy booking context skill search proof');

assert.equal(countRelevantPipeBLines(`${unrelatedRecord}\n${matchingRecord}`, ['run-123']) > 0, true, 'correlated line count reports current-run evidence');
assert.equal(countRelevantPipeBLines(unrelatedRecord, ['run-123']), 0, 'correlated line count ignores unrelated runs');

console.log('booking-pipeb-evidence tests passed');

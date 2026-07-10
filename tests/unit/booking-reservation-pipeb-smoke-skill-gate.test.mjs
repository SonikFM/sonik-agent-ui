import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile('scripts/agent-ui-booking-reservation-pipeb-smoke.mjs', 'utf8');

assert.match(script, /searchSkillCatalog/, 'reservation smoke prompt must require skill catalog discovery');
assert.match(script, /learnSkill/, 'reservation smoke prompt must require learning the workflow skill');
assert.match(script, /booking\.reservation\.create/, 'reservation smoke must name the booking reservation skill');
assert.match(script, /api\.generate\.skill_index_context/, 'reservation smoke must collect startup skill index telemetry');
assert.match(script, /tool\.searchSkillCatalog/, 'reservation smoke must collect skill search telemetry');
assert.match(script, /tool\.learnSkill/, 'reservation smoke must collect skill learn telemetry');
assert.match(script, /booking\.create\.hold/, 'reservation smoke must explicitly guard against the hold command regression');
assert.match(script, /noHoldCommandUsed/, 'reservation smoke must fail if hold command is used');
assert.match(script, /skillWorkflowEvidence/, 'reservation smoke must expose a single skill workflow evidence check');
assert.match(script, /backendEndpointEvidence/, 'reservation smoke must preserve Pipe-B backend endpoint evidence when tool telemetry is redacted');
assert.match(script, /transcriptReceiptEvidence/, 'reservation smoke must require transcript receipt evidence for redacted telemetry fallback');
assert.match(script, /toolTelemetryComplete/, 'reservation smoke must keep first-class Agent UI tool telemetry evidence separate from fallback evidence');
assert.match(script, /previewBookingReservationCommand/, 'reservation smoke must require the preview tool before human approval');
assert.match(script, /data-chat-approval-card/, 'reservation smoke must click the approval card');
assert.match(script, /\/api\/reservation\/commit/, 'reservation smoke must wait for the human-approved commit endpoint');
assert.match(script, /commit\.human_approved/, 'reservation smoke must accept human-approved commit telemetry');

console.log(JSON.stringify({ ok: true, checked: 'booking-reservation-pipeb-smoke-skill-gate' }));

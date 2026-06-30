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

console.log(JSON.stringify({ ok: true, checked: 'booking-reservation-pipeb-smoke-skill-gate' }));

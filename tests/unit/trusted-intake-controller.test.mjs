import assert from 'node:assert/strict';
import {
  decideTrustedIntakeControllerAction,
  isTrustedIntakeControllerAction,
} from '../../apps/standalone-sveltekit/src/lib/agent-workflows/trusted-intake-controller.ts';

assert.equal(isTrustedIntakeControllerAction('approveAndRun'), true);
assert.equal(isTrustedIntakeControllerAction('commitCommand'), false);

const ready = { ready: true, visible: true, reason: null };
const notReady = { ready: false, visible: false, reason: 'Answer setup type and inventory before previewing.' };

assert.deepEqual(
  decideTrustedIntakeControllerAction({ actionName: 'approveAndRun', isBookingIntakeArtifact: false, readiness: ready }),
  {
    ok: false,
    code: 'not_booking_intake',
    commandId: 'booking.create.context',
    reason: 'Open a booking intake draft before running setup actions.',
  },
);

assert.deepEqual(
  decideTrustedIntakeControllerAction({ actionName: 'approveAndRun', isBookingIntakeArtifact: true, readiness: notReady }),
  {
    ok: false,
    code: 'approval_not_ready',
    commandId: 'booking.create.context',
    reason: 'Answer setup type and inventory before previewing.',
  },
);

assert.deepEqual(
  decideTrustedIntakeControllerAction({ actionName: 'requestApproval', isBookingIntakeArtifact: true, readiness: ready }),
  { ok: true, code: 'accepted', commandId: 'booking.create.context', reason: null },
);

assert.deepEqual(
  decideTrustedIntakeControllerAction({ actionName: 'saveDraft', isBookingIntakeArtifact: true, readiness: notReady }),
  { ok: true, code: 'accepted', commandId: 'booking.create.context', reason: null },
);

console.log('trusted intake controller tests passed');

import { describe, expect, it } from 'vitest';
import { assertNoSlice1TransactionCapability, evaluatePolicy, slice1DeniedExamples } from '@sonikfm/policy';
import { createSonikRegistry } from '@sonikfm/sonik-adapter';

describe('Slice policy gates', () => {
  it('allows registered read-only fixture/API preview commands', () => {
    const decision = assertNoSlice1TransactionCapability(createSonikRegistry().list());
    expect(decision.decision).toBe('allow');
  });


  it('allows purchase preview while keeping checkout unavailable', async () => {
    const descriptor = createSonikRegistry().get('sonik.purchase.preview');
    expect(descriptor?.policy.readOnly).toBe(true);
    const decision = evaluatePolicy({ commandId: 'sonik.purchase.preview', hostProfile: 'claude', capabilities: descriptor?.capabilities ?? [], readOnly: descriptor?.policy.readOnly ?? false });
    expect(decision.decision).toBe('allow');
    expect(decision.reasons).toContain('read_only_command_allowed');
    expect(decision.reasons).not.toContain('slice_1_read_only_fixture_allowed');
  });

  it('denies payment/checkout/claim/passkit/account-linking examples', () => {
    for (const commandId of slice1DeniedExamples) {
      expect(evaluatePolicy({ commandId, hostProfile: 'local', capabilities: ['payment'], readOnly: false }).decision).toBe('deny');
    }
  });

  it('denies pay_in_app for Claude and unknown host profiles', () => {
    expect(evaluatePolicy({ commandId: 'sonik.offer.pay', hostProfile: 'claude', capabilities: ['pay_in_app'], readOnly: false }).reasons).toContain('claude_cannot_receive_pay_in_app');
    expect(evaluatePolicy({ commandId: 'sonik.offer.pay', hostProfile: 'unknown', capabilities: ['pay_in_app'], readOnly: false }).reasons).toContain('unknown_cannot_receive_pay_in_app');
  });
});

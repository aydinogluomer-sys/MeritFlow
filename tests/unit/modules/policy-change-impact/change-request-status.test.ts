import { describe, expect, it } from 'vitest';
import {
  canTransition,
  assertTransition,
  isTerminalStatus,
  CHANGE_REQUEST_STATUSES,
} from '@/modules/policy-change-impact';

describe('change-request status machine (mirror of migration 0043)', () => {
  it('allows the governance happy path', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'approved')).toBe(true);
    expect(canTransition('submitted', 'rejected')).toBe(true);
    expect(canTransition('submitted', 'changes_requested')).toBe(true);
    expect(canTransition('changes_requested', 'submitted')).toBe(true);
  });

  it('forbids skips and illegal jumps', () => {
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('draft', 'rejected')).toBe(false);
    expect(canTransition('submitted', 'draft')).toBe(false);
    expect(canTransition('changes_requested', 'approved')).toBe(false);
  });

  it('treats approved and rejected as terminal', () => {
    expect(isTerminalStatus('approved')).toBe(true);
    expect(isTerminalStatus('rejected')).toBe(true);
    expect(isTerminalStatus('submitted')).toBe(false);
    expect(isTerminalStatus('changes_requested')).toBe(false);
    for (const to of CHANGE_REQUEST_STATUSES) {
      expect(canTransition('approved', to)).toBe(false);
      expect(canTransition('rejected', to)).toBe(false);
    }
  });

  it('assertTransition throws on illegal and passes on legal', () => {
    expect(() => assertTransition('draft', 'approved')).toThrow(/invalid policy change request transition/);
    expect(() => assertTransition('draft', 'submitted')).not.toThrow();
    expect(() => assertTransition('submitted', 'approved')).not.toThrow();
  });
});

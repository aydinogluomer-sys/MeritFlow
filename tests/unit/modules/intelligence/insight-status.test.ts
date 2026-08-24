import { describe, expect, it } from 'vitest';
import {
  canTransition,
  assertTransition,
  nextStatuses,
  isTerminalStatus,
} from '@/modules/intelligence';

describe('insight status lifecycle (§2.8)', () => {
  it('allows the canonical forward path', () => {
    expect(canTransition('draft', 'calculated')).toBe(true);
    expect(canTransition('calculated', 'reviewed')).toBe(true);
    expect(canTransition('reviewed', 'accepted')).toBe(true);
    expect(canTransition('reviewed', 'dismissed')).toBe(true);
    expect(canTransition('accepted', 'applied')).toBe(true);
    expect(canTransition('applied', 'observed')).toBe(true);
    expect(canTransition('observed', 'retrospective')).toBe(true);
  });

  it('forbids skipping states and going backwards', () => {
    expect(canTransition('draft', 'reviewed')).toBe(false);
    expect(canTransition('calculated', 'draft')).toBe(false);
    expect(canTransition('accepted', 'dismissed')).toBe(false);
  });

  it('reports terminal states', () => {
    expect(isTerminalStatus('dismissed')).toBe(true);
    expect(isTerminalStatus('retrospective')).toBe(true);
    expect(isTerminalStatus('draft')).toBe(false);
    expect(nextStatuses('reviewed')).toEqual(['accepted', 'dismissed']);
    expect(nextStatuses('dismissed')).toEqual([]);
  });

  it('assertTransition throws on an illegal move', () => {
    expect(() => assertTransition('draft', 'applied')).toThrow(/illegal insight status transition/);
    expect(() => assertTransition('draft', 'calculated')).not.toThrow();
  });
});

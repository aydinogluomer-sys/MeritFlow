import { describe, expect, it } from 'vitest';
import { FakeClock, SystemClock, systemClock } from '@/lib/time';

describe('FakeClock', () => {
  it('now() returns the initial time', () => {
    const c = new FakeClock('2024-01-15T10:00:00Z');
    expect(c.now().toISOString()).toBe('2024-01-15T10:00:00.000Z');
  });

  it('advance(ms) moves the clock forward', () => {
    const c = new FakeClock('2024-01-15T10:00:00Z');
    c.advance(90_000); // 90s
    expect(c.now().toISOString()).toBe('2024-01-15T10:01:30.000Z');
  });

  it('advance(0) does not change the clock', () => {
    const c = new FakeClock('2024-01-15T10:00:00Z');
    c.advance(0);
    expect(c.now().toISOString()).toBe('2024-01-15T10:00:00.000Z');
  });

  it('setNow() sets an absolute instant', () => {
    const c = new FakeClock('2024-01-15T10:00:00Z');
    c.setNow(new Date('2025-06-01T00:00:00Z'));
    expect(c.now().toISOString()).toBe('2025-06-01T00:00:00.000Z');
  });

  it('each now() returns an independent Date copy (mutating it never affects the clock)', () => {
    const c = new FakeClock('2024-01-15T10:00:00Z');
    const first = c.now();
    first.setFullYear(1999); // mutate the returned Date
    expect(c.now().toISOString()).toBe('2024-01-15T10:00:00.000Z');
    expect(c.now()).not.toBe(first);
  });

  it('default constructor uses the fixed 2024-01-15 anchor', () => {
    expect(new FakeClock().now().toISOString()).toBe('2024-01-15T10:00:00.000Z');
  });
});

describe('SystemClock', () => {
  it('now() is approximately Date.now() (±1s tolerance)', () => {
    const before = Date.now();
    const t = new SystemClock().now().getTime();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before - 1000);
    expect(t).toBeLessThanOrEqual(after + 1000);
  });

  it('systemClock singleton returns a Date', () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });
});

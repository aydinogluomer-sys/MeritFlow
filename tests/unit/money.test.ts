import { describe, expect, it } from 'vitest';
import { assertMinorAmount, toMinorAmount, safeAddMinor } from '@/lib/money';

const MAX = Number.MAX_SAFE_INTEGER; // 9_007_199_254_740_991

describe('assertMinorAmount', () => {
  it('accepts safe non-negative integers (incl. 0 and MAX_SAFE_INTEGER)', () => {
    expect(() => assertMinorAmount(0)).not.toThrow();
    expect(() => assertMinorAmount(1)).not.toThrow();
    expect(() => assertMinorAmount(1_000_000)).not.toThrow();
    expect(() => assertMinorAmount(MAX)).not.toThrow();
    expect(() => assertMinorAmount(-0)).not.toThrow(); // -0 === 0
  });

  it('rejects values above MAX_SAFE_INTEGER', () => {
    expect(() => assertMinorAmount(MAX + 1)).toThrow(RangeError);
    expect(() => assertMinorAmount(MAX + 2)).toThrow(RangeError);
  });

  it('rejects negatives', () => {
    expect(() => assertMinorAmount(-1)).toThrow(RangeError);
  });

  it('rejects floats', () => {
    expect(() => assertMinorAmount(1.5)).toThrow(RangeError);
    expect(() => assertMinorAmount(0.1)).toThrow(RangeError);
  });

  it('rejects NaN / Infinity / -Infinity', () => {
    expect(() => assertMinorAmount(NaN)).toThrow(RangeError);
    expect(() => assertMinorAmount(Infinity)).toThrow(RangeError);
    expect(() => assertMinorAmount(-Infinity)).toThrow(RangeError);
  });

  it('includes the label in the error message', () => {
    expect(() => assertMinorAmount(-1, 'poolAmount')).toThrow(/poolAmount/);
  });
});

describe('toMinorAmount', () => {
  it('coerces numeric strings', () => {
    expect(toMinorAmount('1234')).toBe(1234);
    expect(toMinorAmount('0')).toBe(0);
    expect(toMinorAmount('9007199254740991')).toBe(MAX);
  });

  it('passes numbers through', () => {
    expect(toMinorAmount(500)).toBe(500);
  });

  it('throws on a string that parses above the safe-integer ceiling', () => {
    // Number('9007199254740993') rounds to 9007199254740992 (= 2^53, MAX+1) — unsafe.
    expect(() => toMinorAmount('9007199254740993')).toThrow(RangeError);
  });

  it('throws on a float number', () => {
    expect(() => toMinorAmount(1.5)).toThrow(RangeError);
  });

  it('throws on a negative string', () => {
    expect(() => toMinorAmount('-1')).toThrow(RangeError);
  });

  it('empty string coerces to 0 (Number("") === 0) — documented behavior', () => {
    expect(toMinorAmount('')).toBe(0);
  });
});

describe('safeAddMinor', () => {
  it('adds safely within range', () => {
    expect(safeAddMinor(100, 200)).toBe(300);
    expect(safeAddMinor(0, 0)).toBe(0);
    expect(safeAddMinor(MAX, 0)).toBe(MAX);
  });

  it('throws on overflow past MAX_SAFE_INTEGER', () => {
    expect(() => safeAddMinor(MAX, 1)).toThrow(RangeError);
  });

  it('two halves of MAX stay safe', () => {
    const half = Math.floor(MAX / 2); // 4_503_599_627_370_495
    expect(() => safeAddMinor(half, half)).not.toThrow();
    expect(safeAddMinor(half, half)).toBe(half * 2);
  });
});

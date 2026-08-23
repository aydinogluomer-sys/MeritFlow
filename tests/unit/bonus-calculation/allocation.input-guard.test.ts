import { describe, expect, it } from 'vitest';
import { allocateBonus, type EmployeeInput, type PoolConfig } from '@/modules/bonus-calculation';

// ENGINEERING-25 — the money inputs to allocateBonus are guarded to safe non-negative integers.
// (The algorithm itself is unchanged / mutation-tested in E21; this only pins the entry guards.)
const MAX = Number.MAX_SAFE_INTEGER;

const emp = (capBasisMinor: number | null): EmployeeInput => ({
  employeeId: 'e1',
  adjustedScore: 1, // > 0 so the employee is eligible and the cap-basis guard runs
  capBasisMinor,
  prorataFactor: 1,
});

const poolWith = (amountMinor: number): PoolConfig => ({
  amountMinor,
  tOrg: 1,
  topUpApproved: false,
  capRate: 0.5,
});

describe('allocateBonus — money input guards', () => {
  it('rejects a float pool amount', () => {
    expect(() => allocateBonus([emp(null)], poolWith(1.5))).toThrow(/pool\.amountMinor/);
  });

  it('rejects a negative pool amount', () => {
    expect(() => allocateBonus([emp(null)], poolWith(-100))).toThrow(/pool\.amountMinor/);
  });

  it('rejects a pool amount above MAX_SAFE_INTEGER', () => {
    expect(() => allocateBonus([emp(null)], poolWith(MAX + 1))).toThrow(/pool\.amountMinor/);
  });

  it('accepts a zero pool (empty distribution)', () => {
    expect(() => allocateBonus([emp(null)], poolWith(0))).not.toThrow();
  });

  it('rejects a float cap basis', () => {
    expect(() => allocateBonus([emp(1.1)], poolWith(1000))).toThrow(/capBasisMinor/);
  });

  it('accepts a null cap basis (pending, AD6)', () => {
    expect(() => allocateBonus([emp(null)], poolWith(1000))).not.toThrow();
  });

  it('accepts a valid integer cap basis', () => {
    expect(() => allocateBonus([emp(500)], poolWith(1000))).not.toThrow();
  });
});

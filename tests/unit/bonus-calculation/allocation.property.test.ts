import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import {
  allocateBonus,
  type EmployeeInput,
  type PoolConfig,
} from '@/modules/bonus-calculation';

// ENGINEERING-18 — generative property-based / fuzz suite for the pure allocation engine.
// Reproducible: seed 42 (fast-check auto-logs the shrunk counterexample + seed on failure). The
// PR suite runs 250 cases; the nightly-fuzz workflow overrides FAST_CHECK_NUM_RUNS=5000.
const numRuns = Number(process.env.FAST_CHECK_NUM_RUNS ?? 250);
fc.configureGlobal({ numRuns, seed: 42 });

// 1–20 UNIQUE employees; score 0.1..10000 (numeric like the SQL column), cap 0..10M or null
// (~25% null), proration 0..1.
const employeeArb = fc.record({
  employeeId: fc.uuid(),
  adjustedScore: fc.double({ min: 0.1, max: 10_000, noNaN: true, noDefaultInfinity: true }),
  capBasisMinor: fc.option(fc.integer({ min: 0, max: 10_000_000 }), { nil: null, freq: 3 }),
  prorataFactor: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
});

const uniqueEmployeesArb = fc.uniqueArray(employeeArb, {
  selector: (e) => e.employeeId,
  minLength: 1,
  maxLength: 20,
});

const poolArb = fc.record({
  amountMinor: fc.integer({ min: 0, max: 100_000_000 }),
  tOrg: fc.oneof(
    fc.constant(0),
    fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.constant(1.2),
  ),
  topUpApproved: fc.boolean(),
  capRate: fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
});

const isSafeInt = (n: number): boolean => Number.isInteger(n) && Number.isSafeInteger(n);
const isFiniteNum = (n: number): boolean => Number.isFinite(n);

describe('allocateBonus — property-based (fast-check)', () => {
  test('P1 — Σ allocation + undistributed = pool_ref', () => {
    fc.assert(
      fc.property(uniqueEmployeesArb, poolArb, (employees, pool) => {
        const r = allocateBonus(employees, pool as PoolConfig);
        const sum = r.allocations.reduce((acc, a) => acc + a.finalAmountMinor, 0);
        return sum + r.undistributedRemainderMinor === r.poolRefMinor;
      }),
    );
  });

  test('P2 — every allocation >= 0', () => {
    fc.assert(
      fc.property(uniqueEmployeesArb, poolArb, (employees, pool) => {
        const r = allocateBonus(employees, pool as PoolConfig);
        return r.allocations.every((a) => a.finalAmountMinor >= 0);
      }),
    );
  });

  test('P3 — final <= cap for capped rows', () => {
    fc.assert(
      fc.property(uniqueEmployeesArb, poolArb, (employees, pool) => {
        const r = allocateBonus(employees, pool as PoolConfig);
        return r.allocations
          .filter((a) => a.capApplied === 'yes')
          .every((a) => a.capMinor !== null && a.finalAmountMinor <= a.capMinor);
      }),
    );
  });

  test('P4 — same input = same output (determinism)', () => {
    fc.assert(
      fc.property(uniqueEmployeesArb, poolArb, (employees, pool) => {
        const a = allocateBonus(employees, pool as PoolConfig);
        const b = allocateBonus(employees, pool as PoolConfig);
        return JSON.stringify(a) === JSON.stringify(b);
      }),
    );
  });

  test('P5 — input ordering does not change totals', () => {
    fc.assert(
      fc.property(uniqueEmployeesArb, poolArb, (employees, pool) => {
        const original = allocateBonus(employees, pool as PoolConfig);
        const reordered = allocateBonus([...employees].reverse(), pool as PoolConfig);
        // Pool totals are order-independent (Σfinal is a sum of the same per-employee values).
        return (
          original.poolRefMinor === reordered.poolRefMinor &&
          original.distributableMinor === reordered.distributableMinor &&
          original.undistributedRemainderMinor === reordered.undistributedRemainderMinor &&
          // P1 still holds for the reordered run.
          reordered.allocations.reduce((acc, a) => acc + a.finalAmountMinor, 0) +
            reordered.undistributedRemainderMinor ===
            reordered.poolRefMinor
        );
      }),
    );
  });

  test('P6 — tie-break deterministic (lower uuid wins the LR bump)', () => {
    // Two employees, identical score, no cap basis (so both participate in LR), pool that yields
    // remainder = 1 → the lexicographically-lower employeeId gets the +1 bump.
    const lower = '00000000-0000-0000-0000-000000000001';
    const higher = '00000000-0000-0000-0000-000000000002';
    const employees: EmployeeInput[] = [
      { employeeId: higher, adjustedScore: 1, capBasisMinor: null, prorataFactor: 1 },
      { employeeId: lower, adjustedScore: 1, capBasisMinor: null, prorataFactor: 1 },
    ];
    // A=3, T=1 → distributable=3; each rawShare=1.5→floor 1; Σ=2; remainder=1; both frac=0.5.
    const r = allocateBonus(employees, { amountMinor: 3, tOrg: 1, topUpApproved: false, capRate: 0.5 });
    const lowerRow = r.allocations.find((a) => a.employeeId === lower)!;
    const higherRow = r.allocations.find((a) => a.employeeId === higher)!;
    expect(lowerRow.roundingAdjustmentMinor).toBe(1);
    expect(higherRow.roundingAdjustmentMinor).toBe(0);
    expect(lowerRow.finalAmountMinor).toBe(2);
    expect(higherRow.finalAmountMinor).toBe(1);
  });

  test('P7 — zero-score employees excluded; undistributed = pool_ref', () => {
    fc.assert(
      fc.property(uniqueEmployeesArb, poolArb, (employees, pool) => {
        const zeroed = employees.map((e) => ({ ...e, adjustedScore: 0 }));
        const r = allocateBonus(zeroed, pool as PoolConfig);
        return (
          r.allocations.length === 0 && r.undistributedRemainderMinor === r.poolRefMinor
        );
      }),
    );
  });

  test('P8 — no NaN or Infinity in output', () => {
    fc.assert(
      fc.property(uniqueEmployeesArb, poolArb, (employees, pool) => {
        const r = allocateBonus(employees, pool as PoolConfig);
        if (!isFiniteNum(r.undistributedRemainderMinor) || !isFiniteNum(r.poolRefMinor)) return false;
        if (!isFiniteNum(r.distributableMinor)) return false;
        return r.allocations.every(
          (a) =>
            isFiniteNum(a.finalAmountMinor) &&
            isFiniteNum(a.rawShareMinor) &&
            (a.capMinor === null || isFiniteNum(a.capMinor)),
        );
      }),
    );
  });

  test('P9 — all monetary values are safe integers', () => {
    fc.assert(
      fc.property(uniqueEmployeesArb, poolArb, (employees, pool) => {
        const r = allocateBonus(employees, pool as PoolConfig);
        if (
          !isSafeInt(r.undistributedRemainderMinor) ||
          !isSafeInt(r.poolRefMinor) ||
          !isSafeInt(r.distributableMinor)
        ) {
          return false;
        }
        return r.allocations.every(
          (a) =>
            isSafeInt(a.finalAmountMinor) &&
            isSafeInt(a.rawShareMinor) &&
            isSafeInt(a.roundingAdjustmentMinor) &&
            (a.capMinor === null || isSafeInt(a.capMinor)),
        );
      }),
    );
  });

  test('P10 — missing cap basis → pending row present (payout blocked)', () => {
    fc.assert(
      fc.property(uniqueEmployeesArb, poolArb, (employees, pool) => {
        // Force at least one missing-cap employee (score > 0 already, so it survives the filter).
        const withNull = employees.map((e, i) => (i === 0 ? { ...e, capBasisMinor: null } : e));
        const r = allocateBonus(withNull, pool as PoolConfig);
        return r.allocations.some((a) => a.capApplied === 'pending_missing_cap_basis');
      }),
    );
  });

  describe('large-value smoke', () => {
    test('1000 employees, pool 50M — P1/P8/P9 hold', () => {
      const employees: EmployeeInput[] = Array.from({ length: 1000 }, (_, i) => ({
        employeeId: `emp-${String(i).padStart(4, '0')}`,
        adjustedScore: (i % 50) + 1,
        capBasisMinor: 5_000_000,
        prorataFactor: 1,
      }));
      const r = allocateBonus(employees, {
        amountMinor: 50_000_000,
        tOrg: 1,
        topUpApproved: false,
        capRate: 0.5,
      });
      const sum = r.allocations.reduce((acc, a) => acc + a.finalAmountMinor, 0);
      expect(sum + r.undistributedRemainderMinor).toBe(r.poolRefMinor); // P1
      expect(r.allocations.every((a) => isFiniteNum(a.finalAmountMinor))).toBe(true); // P8
      expect(r.allocations.every((a) => isSafeInt(a.finalAmountMinor))).toBe(true); // P9
      expect(isSafeInt(r.undistributedRemainderMinor)).toBe(true);
    });

    test('single employee, pool 1, cap 0 — alloc 0, undistributed 1', () => {
      const r = allocateBonus(
        [{ employeeId: 'solo', adjustedScore: 1, capBasisMinor: 0, prorataFactor: 1 }],
        { amountMinor: 1, tOrg: 1, topUpApproved: false, capRate: 0.5 },
      );
      expect(r.allocations[0]!.finalAmountMinor).toBe(0);
      expect(r.allocations[0]!.capApplied).toBe('yes');
      expect(r.undistributedRemainderMinor).toBe(1);
    });

    test('pool 0 — all allocations 0, undistributed 0', () => {
      const employees: EmployeeInput[] = [
        { employeeId: 'a', adjustedScore: 3, capBasisMinor: 1000, prorataFactor: 1 },
        { employeeId: 'b', adjustedScore: 7, capBasisMinor: null, prorataFactor: 1 },
        { employeeId: 'c', adjustedScore: 1, capBasisMinor: 500, prorataFactor: 0.5 },
      ];
      const r = allocateBonus(employees, { amountMinor: 0, tOrg: 1, topUpApproved: false, capRate: 0.5 });
      expect(r.allocations.every((a) => a.finalAmountMinor === 0)).toBe(true);
      expect(r.undistributedRemainderMinor).toBe(0);
      expect(r.poolRefMinor).toBe(0);
    });
  });
});

import { describe, test } from 'vitest';
import fc from 'fast-check';
import { allocateBonus, type PoolConfig } from '@/modules/bonus-calculation';

// ENGINEERING-25 — property test near the safe-integer ceiling. Money bounds are divided by 100 so
// that the sum across up to 5 employees (plus a 1.2× top-up) still stays under MAX_SAFE_INTEGER.
const numRuns = Number(process.env.FAST_CHECK_NUM_RUNS ?? 250);
fc.configureGlobal({ numRuns, seed: 42 });

const MAX = Number.MAX_SAFE_INTEGER;
const BIG = Math.floor(MAX / 100); // 90_071_992_547_409
const isSafeInt = (n: number): boolean => Number.isInteger(n) && Number.isSafeInteger(n);

const employeeArb = fc.record({
  employeeId: fc.uuid(),
  adjustedScore: fc.double({ min: 0.1, max: 10_000, noNaN: true, noDefaultInfinity: true }),
  capBasisMinor: fc.option(fc.integer({ min: 0, max: BIG }), { nil: null, freq: 3 }),
  prorataFactor: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
});
const employeesArb = fc.uniqueArray(employeeArb, {
  selector: (e) => e.employeeId,
  minLength: 1,
  maxLength: 5,
});
const poolArb = fc.record({
  amountMinor: fc.integer({ min: 0, max: BIG }),
  tOrg: fc.oneof(
    fc.constant(0),
    fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.constant(1.2),
  ),
  topUpApproved: fc.boolean(),
  capRate: fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
});

describe('allocateBonus — large-value safe-integer property', () => {
  test('every monetary output is a safe integer near the ceiling', () => {
    fc.assert(
      fc.property(employeesArb, poolArb, (employees, pool) => {
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
            (a.capMinor === null || isSafeInt(a.capMinor)),
        );
      }),
    );
  });

  test('SI-13 holds at scale: Σfinal + undistributed = pool_ref', () => {
    fc.assert(
      fc.property(employeesArb, poolArb, (employees, pool) => {
        const r = allocateBonus(employees, pool as PoolConfig);
        const sum = r.allocations.reduce((acc, a) => acc + a.finalAmountMinor, 0);
        return sum + r.undistributedRemainderMinor === r.poolRefMinor;
      }),
    );
  });
});

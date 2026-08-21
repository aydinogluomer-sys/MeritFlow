import { describe, expect, it } from 'vitest';
import { allocateBonus, type EmployeeInput, type PoolConfig } from '@/modules/bonus-calculation';

// ENGINEERING-21 — mutation-killing deterministic coverage for allocateBonus. The property suite
// (allocation.property.test.ts) proves invariants, but P1 (Σfinal + undistributed = pool_ref) is
// TAUTOLOGICAL (undistributed is derived as pool_ref − Σfinal), so it cannot catch a mutated raw
// share / cap / distributable value. These tests pin EXACT hand-computed outputs for the branch and
// arithmetic paths the fuzzer leaves ambiguous.

const emp = (
  employeeId: string,
  adjustedScore: number,
  capBasisMinor: number | null,
  prorataFactor = 1,
): EmployeeInput => ({ employeeId, adjustedScore, capBasisMinor, prorataFactor });

const pool = (amountMinor: number, tOrg: number, topUpApproved = false, capRate = 0.5): PoolConfig => ({
  amountMinor,
  tOrg,
  topUpApproved,
  capRate,
});

describe('allocateBonus — distributable + pool_ref (AD8 branches)', () => {
  it('T = 0: distributable 0, pool_ref = A (pool preserved, nothing distributed)', () => {
    const r = allocateBonus([emp('a', 5, null)], pool(100, 0));
    expect(r.distributableMinor).toBe(0);
    expect(r.poolRefMinor).toBe(100);
  });

  it('fractional T (0.5): distributable = floor(A*T), pool_ref = A', () => {
    // Kills the `T <= 1` branch flips + `Math.floor(A * T)` -> `A / T`: floor(100*0.5)=50, not 100/200.
    const r = allocateBonus([emp('a', 5, null)], pool(100, 0.5));
    expect(r.distributableMinor).toBe(50);
    expect(r.poolRefMinor).toBe(100);
  });

  it('T = 1: distributable = A, pool_ref = A', () => {
    const r = allocateBonus([emp('a', 5, null)], pool(100, 1));
    expect(r.distributableMinor).toBe(100);
    expect(r.poolRefMinor).toBe(100);
  });

  it('T = 1.2 WITH top-up: distributable = floor(A*1.2) AND pool_ref = distributable (AD8 top-up)', () => {
    // Kills the `T === 1.2 && topUpApproved` branch flips + `Math.floor(A * 1.2)` -> `A / 1.2`.
    const r = allocateBonus([emp('a', 5, null)], pool(100, 1.2, true));
    expect(r.distributableMinor).toBe(120);
    expect(r.poolRefMinor).toBe(120);
  });

  it('T = 1.2 WITHOUT top-up: capped at the pool — distributable = A, pool_ref = A', () => {
    // Distinguishes the top-up branch: pool_ref is A (100), NOT floor(A*1.2) (120).
    const r = allocateBonus([emp('a', 5, null)], pool(100, 1.2, false));
    expect(r.distributableMinor).toBe(100);
    expect(r.poolRefMinor).toBe(100);
  });
});

describe('allocateBonus — pro-rata share math (exact)', () => {
  it('two uncapped employees split the pool by score with floor + largest-remainder', () => {
    // A=10,T=1 -> distributable 10; sumAdj 4. s1: 10*1/4=2.5 -> floor 2 (frac .5); s3: 10*3/4=7.5 ->
    // floor 7 (frac .5). Σ=9, remainder 1; equal frac -> lower id 's1' gets the +1 bump.
    const r = allocateBonus([emp('s1', 1, null), emp('s3', 3, null)], pool(10, 1));
    const s1 = r.allocations.find((a) => a.employeeId === 's1')!;
    const s3 = r.allocations.find((a) => a.employeeId === 's3')!;
    // Kills `(distributable * score) / sumAdj` -> `distributable / score` (would give 10 and 3).
    expect(s1.rawShareMinor).toBe(2);
    expect(s3.rawShareMinor).toBe(7);
    expect(s1.finalAmountMinor).toBe(3); // 2 + LR bump
    expect(s3.finalAmountMinor).toBe(7);
    expect(r.undistributedRemainderMinor).toBe(0);
  });
});

describe('allocateBonus — largest-remainder ordering (frac desc, id asc)', () => {
  it('the HIGHER fractional remainder wins the bump even when its id sorts LAST', () => {
    // sumAdj 100; A=10,T=1 -> distributable 10. z: 10*9/100=0.9 -> floor 0 (frac .9); a: 10*91/100=
    // 9.1 -> floor 9 (frac .1). remainder 1. Real: frac desc -> 'z' (0.9) bumped, though 'a' < 'z'.
    // Kills: frac sign flip (rawShareNum + floor), and the "ignore frac / sort by id only" mutant
    // (which would bump 'a').
    const r = allocateBonus([emp('a', 91, null), emp('z', 9, null)], pool(10, 1));
    const z = r.allocations.find((x) => x.employeeId === 'z')!;
    const a = r.allocations.find((x) => x.employeeId === 'a')!;
    expect(z.roundingAdjustmentMinor).toBe(1);
    expect(a.roundingAdjustmentMinor).toBe(0);
    expect(z.finalAmountMinor).toBe(1);
    expect(a.finalAmountMinor).toBe(9);
  });

  it('EQUAL fractional remainders: the lowest id wins the single bump (deterministic tie-break)', () => {
    // 3 equal scores; A=10,T=1 -> distributable 10; each 10/3=3.333 -> floor 3 (frac .333). Σ=9,
    // remainder 1; all fracs equal -> id asc -> 'a' bumped. Kills the id-comparison direction flips.
    const r = allocateBonus([emp('c', 1, null), emp('b', 1, null), emp('a', 1, null)], pool(10, 1));
    const byId = Object.fromEntries(r.allocations.map((x) => [x.employeeId, x.finalAmountMinor]));
    expect(byId.a).toBe(4);
    expect(byId.b).toBe(3);
    expect(byId.c).toBe(3);
  });
});

describe('allocateBonus — cap application (D6/D10/AD6)', () => {
  it('cap BINDS: final = cap, capApplied yes, cap residual is NOT redistributed', () => {
    // single emp, A=10,T=1 -> rawShare 10; capBasis 10, capRate .5 -> cap floor(10*.5*1)=5 < 10 ->
    // 'yes', final 5. remainder 5 but capped rows are excluded from LR (D6) -> no bump; undistributed 5.
    const r = allocateBonus([emp('a', 1, 10)], pool(10, 1));
    const a = r.allocations[0]!;
    expect(a.capMinor).toBe(5); // kills `capBasis / capRate` (would be floor(10/.5)=20)
    expect(a.capApplied).toBe('yes');
    expect(a.finalAmountMinor).toBe(5);
    expect(a.roundingAdjustmentMinor).toBe(0);
    expect(r.undistributedRemainderMinor).toBe(5);
  });

  it('cap EQUALS raw share: not applied (strict <, boundary) — capApplied no', () => {
    // capBasis 20, capRate .5 -> cap floor(20*.5)=10 == rawShare 10. cap < raw is FALSE -> 'no'.
    // Kills `cap <= rawShareMinor` (would flip to 'yes') and the 'no' string / always-'yes' mutants.
    const r = allocateBonus([emp('a', 1, 20)], pool(10, 1));
    const a = r.allocations[0]!;
    expect(a.capMinor).toBe(10);
    expect(a.capApplied).toBe('no');
    expect(a.finalAmountMinor).toBe(10);
  });

  it('missing cap basis: capMinor is null and the row is pending (AD6)', () => {
    // Kills `capBasis === null ? null : floor(...)` -> always-floor (would compute capMinor = 0).
    const r = allocateBonus([emp('a', 1, null)], pool(10, 1));
    const a = r.allocations[0]!;
    expect(a.capMinor).toBeNull();
    expect(a.capApplied).toBe('pending_missing_cap_basis');
  });
});

// ── EQUIVALENT-MUTANT TRIAGE (ENGINEERING-21) ────────────────────────────────────────────────────
// After this suite, allocation.ts mutation score is 88.66% with 11 SURVIVED mutants. Each was
// analysed and is EQUIVALENT (produces identical output for every reachable input), so it is NOT
// killable by any test — they are documented here rather than disabled (their lines also carry
// KILLED mutants of the same type, so a `// Stryker disable` would hide real coverage). Refactoring
// the production algorithm to remove the redundancy is out of ENGINEERING-21 scope.
//
//   L53  `if (T === 0)` -> false        : T=0 flows through `else if (T <= 1)` identically
//                                          (floor(A*0)=0, pool_ref=A) — the branch is redundant.
//   L56  `T <= 1` -> `T < 1`            : differ only at T=1, where both paths give distributable=A,
//                                          pool_ref=A. (Valid T ∈ {0, (0,1], 1.2}.)
//   L59  `T === 1.2` -> true            : this else-if is reached only when T>1; the only valid T>1
//                                          is 1.2, so `T === 1.2` is already true there.
//   L82  `sumAdj === 0 ? 0 : …` -> false: unreachable — `work` maps over `eligible` (score>0), so
//                                          sumAdj is always > 0 inside the map.
//   L108 `remainder > 0` -> true / >=0  : redundant guard — the loop bound `Math.min(remainder, …)`
//                                          already does nothing when remainder is 0.
//   L113 id tie-break `… ? 1 : 0` (×5)  : the `? 1 : 0` second branch is redundant. For DISTINCT ids
//                                          the `a < b ? -1` first branch alone yields a stable
//                                          ascending sort; returning 1 vs 0 (or `<=`/`>=`) for the
//                                          a>b case never changes the resulting order or the bump.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

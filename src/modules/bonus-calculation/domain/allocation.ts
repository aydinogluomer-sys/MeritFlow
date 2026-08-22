// ENGINEERING-18 — pure TypeScript mirror of the PostgreSQL Safe Pro-Rata engine
// (migration 0028 run_bonus_calculation, latest CREATE OR REPLACE of 0021/0024). NO Supabase, NO
// network, NO randomness — a deterministic reference implementation so the allocation algorithm can
// be property-fuzzed in memory. Every rounding uses Math.floor (SQL floor()); never round/ceil.
//
// Decision Lock mirrored here: D1 (Safe Pro-Rata, factors=1 → the caller supplies adjustedScore),
// D6 (capped rows excluded from the largest-remainder bump), D10 (proration applies to the CAP
// only, not the score), AD6 (missing cap_basis → pending_missing_cap_basis), AD8 (T_org: T=1.2
// needs top_up_approved, else the pool stays as pool_ref).
//
// ENGINEERING-25: minor-unit money inputs (amountMinor, capBasisMinor) are guarded to safe
// non-negative integers at entry. Factors (adjustedScore, capRate, prorataFactor) are float and are
// NOT guarded — they are multipliers, not money.
import { assertMinorAmount } from '@/lib/money';

export interface EmployeeInput {
  employeeId: string;
  adjustedScore: number; // approved_points × eligibility_factor; only > 0 participates
  capBasisMinor: number | null; // null → pending_missing_cap_basis
  prorataFactor: number; // 0..1 inclusive; applies to the cap only (D10)
}

export interface PoolConfig {
  amountMinor: number; // A — non-negative safe integer (minor units)
  tOrg: number; // 0, ≤1, or 1.2 (the only valid values per AD8)
  topUpApproved: boolean;
  capRate: number; // 0..1 (org default 0.50)
}

export type CapApplied = 'yes' | 'no' | 'pending_missing_cap_basis';

export interface AllocationRow {
  employeeId: string;
  rawShareMinor: number; // floor of the pro-rata share
  finalAmountMinor: number; // after cap + largest-remainder bump
  capMinor: number | null; // null when cap_basis_minor is null
  capApplied: CapApplied;
  roundingAdjustmentMinor: number; // 0 or 1 (LR bump)
}

export interface AllocationResult {
  allocations: AllocationRow[];
  undistributedRemainderMinor: number;
  poolRefMinor: number;
  distributableMinor: number;
}

/**
 * Allocate a bonus pool across employees using Safe Pro-Rata + largest-remainder rounding, exactly
 * as the SQL engine does. Pure and deterministic; never throws on any valid financial input.
 */
export function allocateBonus(employees: EmployeeInput[], pool: PoolConfig): AllocationResult {
  const { amountMinor: A, tOrg: T, topUpApproved, capRate } = pool;

  // ENGINEERING-25: guard the money inputs (safe non-negative integers) at the boundary.
  assertMinorAmount(pool.amountMinor, 'pool.amountMinor');

  // ── distributable + pool_ref (AD8) ──────────────────────────────────────────────────────────
  let distributableMinor: number;
  let poolRefMinor: number;
  if (T === 0) {
    distributableMinor = 0;
    poolRefMinor = A;
  } else if (T <= 1) {
    distributableMinor = Math.floor(A * T);
    poolRefMinor = A;
  } else if (T === 1.2 && topUpApproved) {
    distributableMinor = Math.floor(A * 1.2);
    poolRefMinor = distributableMinor;
  } else {
    // T = 1.2 without top-up (or any T > 1 not covered above): cap at the pool (AD8).
    distributableMinor = A;
    poolRefMinor = A;
  }

  // Only NET adjusted_score > 0 participates (mirrors the SQL WHERE clause).
  const eligible = employees.filter((e) => e.adjustedScore > 0);
  const sumAdj = eligible.reduce((acc, e) => acc + e.adjustedScore, 0);

  interface Work {
    employeeId: string;
    rawShareMinor: number;
    frac: number;
    capMinor: number | null;
    capApplied: CapApplied;
    allocMinor: number;
  }

  const work: Work[] = eligible.map((e) => {
    // ENGINEERING-25: a present cap basis is money — guard it (null = pending, AD6, is valid).
    if (e.capBasisMinor !== null) assertMinorAmount(e.capBasisMinor, 'capBasisMinor');
    const rawShareNum = sumAdj === 0 ? 0 : (distributableMinor * e.adjustedScore) / sumAdj;
    const rawShareMinor = Math.floor(rawShareNum);
    const frac = rawShareNum - rawShareMinor;
    const capMinor =
      e.capBasisMinor === null ? null : Math.floor(e.capBasisMinor * capRate * e.prorataFactor);

    let capApplied: CapApplied;
    let allocMinor: number;
    if (e.capBasisMinor === null) {
      capApplied = 'pending_missing_cap_basis';
      allocMinor = rawShareMinor; // provisional floor (cap basis unknown — AD6)
    } else {
      const cap = capMinor as number;
      capApplied = cap < rawShareMinor ? 'yes' : 'no';
      allocMinor = Math.min(cap, rawShareMinor);
    }
    return { employeeId: e.employeeId, rawShareMinor, frac, capMinor, capApplied, allocMinor };
  });

  const distSum = work.reduce((acc, w) => acc + w.allocMinor, 0);
  const remainder = Math.max(distributableMinor - distSum, 0);

  // Largest remainder: +1 kuruş to the top `remainder` UNCAPPED rows, ordered (frac desc,
  // employeeId asc). Capped ('yes') rows are excluded (D6: cap residual is not redistributed);
  // pending_missing_cap_basis rows DO participate (they are cap_applied <> 'yes' in the SQL).
  const bumped = new Set<string>();
  if (remainder > 0) {
    const uncapped = work
      .filter((w) => w.capApplied !== 'yes')
      .sort((a, b) => {
        if (b.frac !== a.frac) return b.frac - a.frac; // frac DESC
        return a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0; // id ASC
      });
    for (let i = 0; i < Math.min(remainder, uncapped.length); i += 1) {
      bumped.add(uncapped[i]!.employeeId);
    }
  }

  const allocations: AllocationRow[] = work.map((w) => {
    const roundingAdjustmentMinor = bumped.has(w.employeeId) ? 1 : 0;
    return {
      employeeId: w.employeeId,
      rawShareMinor: w.rawShareMinor,
      finalAmountMinor: w.allocMinor + roundingAdjustmentMinor,
      capMinor: w.capMinor,
      capApplied: w.capApplied,
      roundingAdjustmentMinor,
    };
  });

  const finalSum = allocations.reduce((acc, a) => acc + a.finalAmountMinor, 0);
  // SI-13 by construction: Σfinal + undistributed = pool_ref.
  const undistributedRemainderMinor = poolRefMinor - finalSum;

  return { allocations, undistributedRemainderMinor, poolRefMinor, distributableMinor };
}

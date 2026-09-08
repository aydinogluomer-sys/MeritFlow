// Impact backtest engine (Module 6-B). PURE + DETERMINISTIC + ADVISORY. Over a FROZEN reference
// dataset (approved tasks + eligibility + comp + pool of a locked reference period), re-score every
// approved task under from_version vs to_draft_version (scoring mirror), aggregate to approved_points
// per employee, and run the REUSED allocateBonus engine for BOTH versions with an IDENTICAL PoolConfig.
// Then compute the §8.5 impact summary. NO ledger write, NO run_bonus_calculation, NO policy mutation.
// Same reference dataset + same two versions -> byte-identical result.
import { allocateBonus, type EmployeeInput, type PoolConfig } from '@/modules/bonus-calculation';
import { scoreTask, type ScoringInputs, type ScoringPolicy } from './scoring-mirror';

/** One approved task in the reference period: whose it is + its historical raw scoring inputs. */
export interface ReferenceTask {
  employeeId: string;
  inputs: ScoringInputs;
}

/** An ELIGIBLE employee of the reference period (from bonus_pool_eligibility + comp). */
export interface ReferenceEmployee {
  employeeId: string;
  eligibilityFactor: number; // approved_points × this = adjustedScore (D1: individual weight 1.0)
  prorataFactor: number; // applies to the cap only (D10)
  capBasisMinor: number | null; // null → pending_missing_cap_basis (AD6)
}

export interface ReferenceDataset {
  tasks: ReferenceTask[];
  employees: ReferenceEmployee[]; // only eligible employees participate in allocation
  pool: PoolConfig; // amountMinor, tOrg, topUpApproved, capRate — IDENTICAL for both versions
}

export interface EmployeeImpact {
  employeeId: string;
  fromMinor: number;
  toMinor: number;
  deltaMinor: number; // toMinor − fromMinor
}

/** §8.5 impact summary. Raw minor amounts are the authoritative integers; pct fields are derived. */
export interface ImpactSummary {
  employeesAffected: number; // delta ≠ 0
  higher: number; // delta > 0
  lower: number; // delta < 0
  unchanged: number; // delta = 0
  fromBudgetMinor: number;
  toBudgetMinor: number;
  budgetDeltaMinor: number;
  budgetDeltaPct: number; // budgetDeltaMinor / fromBudgetMinor (0 when fromBudget = 0)
  medianEmployeeDeltaMinor: number;
  maxNegativeDeltaMinor: number; // most negative delta (≤ 0; 0 when none decreased)
}

export interface BacktestResult {
  summary: ImpactSummary;
  distribution: EmployeeImpact[]; // sorted by employeeId
}

/** Aggregate approved_points per eligible employee under one policy; throws if the policy is incomplete. */
function approvedPointsByEmployee(
  dataset: ReferenceDataset,
  policy: ScoringPolicy,
  label: string,
): Map<string, number> {
  const eligible = new Set(dataset.employees.map((e) => e.employeeId));
  const points = new Map<string, number>();
  for (const t of dataset.tasks) {
    if (!eligible.has(t.employeeId)) continue; // non-eligible employees do not participate (e.g. AD6)
    const scored = scoreTask(t.inputs, policy);
    if (scored === null) {
      throw new Error(`${label} scoring policy is incomplete: no multiplier for a task's level`);
    }
    points.set(t.employeeId, (points.get(t.employeeId) ?? 0) + scored);
  }
  return points;
}

/** Run allocateBonus for one policy version; return employeeId → finalAmountMinor. */
function allocateForPolicy(dataset: ReferenceDataset, policy: ScoringPolicy, label: string): Map<string, number> {
  const points = approvedPointsByEmployee(dataset, policy, label);
  const inputs: EmployeeInput[] = dataset.employees.map((e) => ({
    employeeId: e.employeeId,
    adjustedScore: (points.get(e.employeeId) ?? 0) * e.eligibilityFactor,
    capBasisMinor: e.capBasisMinor,
    prorataFactor: e.prorataFactor,
  }));
  const result = allocateBonus(inputs, dataset.pool);
  const byEmp = new Map<string, number>();
  for (const row of result.allocations) byEmp.set(row.employeeId, row.finalAmountMinor);
  return byEmp;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Backtest a proposed policy change over a frozen reference dataset. Deterministic + reproducible.
 * The from-side reproduces the historical allocation when from_version is the version the period used.
 */
export function runBacktest(
  dataset: ReferenceDataset,
  fromPolicy: ScoringPolicy,
  toPolicy: ScoringPolicy,
): BacktestResult {
  const fromAlloc = allocateForPolicy(dataset, fromPolicy, 'from_version');
  const toAlloc = allocateForPolicy(dataset, toPolicy, 'to_draft_version');

  const distribution: EmployeeImpact[] = dataset.employees
    .map((e) => {
      const fromMinor = fromAlloc.get(e.employeeId) ?? 0;
      const toMinor = toAlloc.get(e.employeeId) ?? 0;
      return { employeeId: e.employeeId, fromMinor, toMinor, deltaMinor: toMinor - fromMinor };
    })
    .sort((a, b) => (a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0));

  const deltas = distribution.map((d) => d.deltaMinor);
  const fromBudgetMinor = distribution.reduce((s, d) => s + d.fromMinor, 0);
  const toBudgetMinor = distribution.reduce((s, d) => s + d.toMinor, 0);
  const budgetDeltaMinor = toBudgetMinor - fromBudgetMinor;
  const negatives = deltas.filter((d) => d < 0);

  const summary: ImpactSummary = {
    employeesAffected: deltas.filter((d) => d !== 0).length,
    higher: deltas.filter((d) => d > 0).length,
    lower: deltas.filter((d) => d < 0).length,
    unchanged: deltas.filter((d) => d === 0).length,
    fromBudgetMinor,
    toBudgetMinor,
    budgetDeltaMinor,
    budgetDeltaPct: fromBudgetMinor === 0 ? 0 : budgetDeltaMinor / fromBudgetMinor,
    medianEmployeeDeltaMinor: median(deltas),
    maxNegativeDeltaMinor: negatives.length === 0 ? 0 : Math.min(...negatives),
  };

  return { summary, distribution };
}

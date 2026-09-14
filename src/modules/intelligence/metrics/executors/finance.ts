// Phase P4 — Module 8-A1 · finance executors. payout_total, payout_concentration and budget_variance
// read ONLY the security_invoker finance views (v_finance_payout, v_finance_period_totals) — NEVER raw
// bonus_allocations / point_ledger / compensation (SI-12). Because the views are security_invoker, the
// RLS user client enforces Finance/Auditor/HR visibility by construction; no raw points/comp can leak.
import type { DimensionId } from '../../dimensions/dimension-catalog';
import type { MetricResult } from '../metric-result';
import {
  makeResult,
  narrowedPeriodIds,
  num,
  round,
  filterValuesFor,
  type MetricExecutor,
} from './types';

// ---------------------------------------------------------------------------
// payout_total (minor_currency) ← Σ v_finance_payout.final_amount_minor (net accrual per employee/period).
// A SUM over the finance view (SI-12). An EMPTY read is OMITTED at every level (incl. org-level) — an
// empty slice signals an RLS-denied (non-finance) read, so returning [] lets the caller render an honest
// "unavailable" rather than a fabricated ₺0 (§23). Servable: org, bonus_period, employee.
// ---------------------------------------------------------------------------
export const PAYOUT_TOTAL_SERVABLE: DimensionId[] = ['organization', 'bonus_period', 'employee'];

export const payoutTotalExecutor: MetricExecutor = async (client, plan) => {
  const periodIds = narrowedPeriodIds(plan);
  if (periodIds.length === 0) return [];

  let q = client
    .from('v_finance_payout')
    .select('bonus_period_id, employee_id, final_amount_minor')
    .in('bonus_period_id', periodIds);
  const employeeFilter = filterValuesFor(plan, 'employee');
  if (employeeFilter) q = q.in('employee_id', employeeFilter);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{ bonus_period_id: string | null; employee_id: string | null; final_amount_minor: number | null }>;

  if (plan.groupBy.includes('employee')) {
    const byEmp = new Map<string, number>();
    for (const r of rows) {
      if (!r.employee_id) continue;
      byEmp.set(r.employee_id, (byEmp.get(r.employee_id) ?? 0) + num(r.final_amount_minor));
    }
    return Array.from(byEmp.entries()).map(([id, sum]) =>
      makeResult(plan, 'minor_currency', Math.round(sum), { employee: id }),
    );
  }
  if (plan.groupBy.includes('bonus_period')) {
    const byPeriod = new Map<string, number>();
    for (const r of rows) {
      if (!r.bonus_period_id) continue;
      byPeriod.set(r.bonus_period_id, (byPeriod.get(r.bonus_period_id) ?? 0) + num(r.final_amount_minor));
    }
    return Array.from(byPeriod.entries()).map(([id, sum]) =>
      makeResult(plan, 'minor_currency', Math.round(sum), { bonus_period: id }),
    );
  }
  // org-level total. An empty read signals an RLS-denied (non-finance) slice → return [] so the caller
  // shows an honest "unavailable", NOT a fabricated ₺0 (§23; matches budget_variance/payout_concentration
  // + the employee/bonus_period branches above, which already omit on empty).
  if (rows.length === 0) return [];
  const total = rows.reduce((a, r) => a + num(r.final_amount_minor), 0);
  return [makeResult(plan, 'minor_currency', Math.round(total), {})];
};

// ---------------------------------------------------------------------------
// payout_concentration (score) ← Herfindahl–Hirschman Index over the per-employee payout distribution
// from v_finance_payout: HHI = Σ (sᵢ)², sᵢ = amountᵢ / Σ amount (positive amounts only). Range (0,1];
// higher = more concentrated. A distribution with no positive payout is OMITTED (undefined). Servable:
// org, bonus_period. team is not a finance-view column → 8-A2.
// ---------------------------------------------------------------------------
export const PAYOUT_CONCENTRATION_SERVABLE: DimensionId[] = ['organization', 'bonus_period'];

function hhi(amounts: number[]): number | null {
  const positive = amounts.filter((a) => a > 0);
  const total = positive.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return positive.reduce((acc, a) => acc + (a / total) ** 2, 0);
}

export const payoutConcentrationExecutor: MetricExecutor = async (client, plan) => {
  const periodIds = narrowedPeriodIds(plan);
  if (periodIds.length === 0) return [];

  const { data, error } = await client
    .from('v_finance_payout')
    .select('bonus_period_id, employee_id, final_amount_minor')
    .in('bonus_period_id', periodIds);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ bonus_period_id: string | null; employee_id: string | null; final_amount_minor: number | null }>;

  const results: MetricResult[] = [];
  if (plan.groupBy.includes('bonus_period')) {
    const byPeriod = new Map<string, number[]>();
    for (const r of rows) {
      if (!r.bonus_period_id) continue;
      let arr = byPeriod.get(r.bonus_period_id);
      if (!arr) {
        arr = [];
        byPeriod.set(r.bonus_period_id, arr);
      }
      arr.push(num(r.final_amount_minor));
    }
    for (const [id, amounts] of byPeriod) {
      const score = hhi(amounts);
      if (score !== null) results.push(makeResult(plan, 'score', round(score, 4), { bonus_period: id }));
    }
    return results;
  }

  // org-level: aggregate each employee's total across the resolved periods, then HHI over employees.
  const byEmp = new Map<string, number>();
  for (const r of rows) {
    if (!r.employee_id) continue;
    byEmp.set(r.employee_id, (byEmp.get(r.employee_id) ?? 0) + num(r.final_amount_minor));
  }
  const score = hhi(Array.from(byEmp.values()));
  if (score === null) return [];
  return [makeResult(plan, 'score', round(score, 4), {})];
};

// ---------------------------------------------------------------------------
// budget_variance (percent) ← v_finance_period_totals: (total_accrued − pool_amount) / pool_amount·100.
// A period with no pool (pool_amount null/0) is OMITTED (variance undefined). Servable: org,
// bonus_period. There is no per-team pool in the schema → team is not servable.
// ---------------------------------------------------------------------------
export const BUDGET_VARIANCE_SERVABLE: DimensionId[] = ['organization', 'bonus_period'];

export const budgetVarianceExecutor: MetricExecutor = async (client, plan) => {
  const periodIds = narrowedPeriodIds(plan);
  if (periodIds.length === 0) return [];

  const { data, error } = await client
    .from('v_finance_period_totals')
    .select('bonus_period_id, pool_amount, total_accrued')
    .in('bonus_period_id', periodIds);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ bonus_period_id: string | null; pool_amount: number | null; total_accrued: number | null }>;

  if (plan.groupBy.includes('bonus_period')) {
    const results: MetricResult[] = [];
    for (const r of rows) {
      if (!r.bonus_period_id) continue;
      const pool = num(r.pool_amount);
      if (pool <= 0) continue; // omit periods with no pool
      const variance = ((num(r.total_accrued) - pool) / pool) * 100;
      results.push(makeResult(plan, 'percent', round(variance, 2), { bonus_period: r.bonus_period_id }));
    }
    return results;
  }
  // org-level: (Σ accrued − Σ pool) / Σ pool · 100.
  const poolSum = rows.reduce((a, r) => a + num(r.pool_amount), 0);
  if (poolSum <= 0) return [];
  const accruedSum = rows.reduce((a, r) => a + num(r.total_accrued), 0);
  const variance = ((accruedSum - poolSum) / poolSum) * 100;
  return [makeResult(plan, 'percent', round(variance, 2), {})];
};

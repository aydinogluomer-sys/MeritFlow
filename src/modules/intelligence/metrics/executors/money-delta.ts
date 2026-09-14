// Phase P4 — Module 8-B3 · finance money-delta executors (§10.4 tier iii). Each reads ONE of the 0050
// SI-12-safe definer-rights views (aggregate money only; the view self-gates org + hr/finance/auditor).
// An EMPTY read = a role/RLS-denied slice → return [] so the caller renders an honest "unavailable",
// NEVER a fabricated ₺0 (§23). Deterministic; the RLS user client is passed in (no admin client).
// 8-B4: the 0050 views are now in database.generated.ts, so each executor uses the TYPED client with a
// literal select (no cast) and a shared pure aggregator groups the per-(period,team) rows.
import type { DimensionId } from '../../dimensions/dimension-catalog';
import type { MetricResult } from '../metric-result';
import {
  makeResult,
  narrowedPeriodIds,
  num,
  filterValuesFor,
  type MetricExecutor,
  type ResolvedPlan,
} from './types';

function singleGroupDim(plan: ResolvedPlan): DimensionId | null {
  return plan.groupBy[0] ?? null;
}

interface MoneyRow {
  bonus_period_id: string | null;
  team_id: string | null;
  amount: number | null;
}

/**
 * Group per-(period,team) money rows by the plan's single group dimension (team | bonus_period | org
 * sum). Shared by cap_money_impact + team_cost (both views project the same {period, team, aggregate}
 * shape). Empty rows → [] (a role/RLS-denied slice → honest unavailable, never a fabricated 0).
 */
function aggregatePeriodTeamMoney(plan: ResolvedPlan, rows: MoneyRow[]): MetricResult[] {
  if (rows.length === 0) return [];

  const groupDim = singleGroupDim(plan);
  if (groupDim === 'team') {
    const byTeam = new Map<string, number>();
    for (const r of rows) {
      if (!r.team_id) continue; // an allocation with no primary team cannot be grouped by team
      byTeam.set(r.team_id, (byTeam.get(r.team_id) ?? 0) + num(r.amount));
    }
    return Array.from(byTeam.entries()).map(([id, sum]) =>
      makeResult(plan, 'minor_currency', Math.round(sum), { team: id }),
    );
  }
  if (groupDim === 'bonus_period') {
    const byPeriod = new Map<string, number>();
    for (const r of rows) {
      if (!r.bonus_period_id) continue;
      byPeriod.set(r.bonus_period_id, (byPeriod.get(r.bonus_period_id) ?? 0) + num(r.amount));
    }
    return Array.from(byPeriod.entries()).map(([id, sum]) =>
      makeResult(plan, 'minor_currency', Math.round(sum), { bonus_period: id }),
    );
  }
  const total = rows.reduce((a, r) => a + num(r.amount), 0);
  return [makeResult(plan, 'minor_currency', Math.round(total), {})];
}

// ---------------------------------------------------------------------------
// cap_money_impact ← v_finance_cap_impact: Σ(raw_share−final) for cap_applied='yes' per period/team.
// ---------------------------------------------------------------------------
export const CAP_MONEY_IMPACT_SERVABLE: DimensionId[] = ['organization', 'team', 'bonus_period'];
export const capMoneyImpactExecutor: MetricExecutor = async (client, plan) => {
  const periodIds = narrowedPeriodIds(plan);
  if (periodIds.length === 0) return [];

  const base = client
    .from('v_finance_cap_impact')
    .select('bonus_period_id, team_id, cap_impact_minor')
    .in('bonus_period_id', periodIds);
  const teamFilter = filterValuesFor(plan, 'team');
  const { data, error } = await (teamFilter ? base.in('team_id', teamFilter) : base);
  if (error) throw error;
  const rows: MoneyRow[] = (data ?? []).map((r) => ({
    bonus_period_id: r.bonus_period_id,
    team_id: r.team_id,
    amount: r.cap_impact_minor,
  }));
  return aggregatePeriodTeamMoney(plan, rows);
};

// ---------------------------------------------------------------------------
// team_cost ← v_finance_team_cost: Σ net accrual per SNAPSHOT team (AD9; reconciles to payout_total).
// ---------------------------------------------------------------------------
export const TEAM_COST_SERVABLE: DimensionId[] = ['organization', 'team', 'bonus_period'];
export const teamCostExecutor: MetricExecutor = async (client, plan) => {
  const periodIds = narrowedPeriodIds(plan);
  if (periodIds.length === 0) return [];

  const base = client
    .from('v_finance_team_cost')
    .select('bonus_period_id, team_id, team_cost_minor')
    .in('bonus_period_id', periodIds);
  const teamFilter = filterValuesFor(plan, 'team');
  const { data, error } = await (teamFilter ? base.in('team_id', teamFilter) : base);
  if (error) throw error;
  const rows: MoneyRow[] = (data ?? []).map((r) => ({
    bonus_period_id: r.bonus_period_id,
    team_id: r.team_id,
    amount: r.team_cost_minor,
  }));
  return aggregatePeriodTeamMoney(plan, rows);
};

// ---------------------------------------------------------------------------
// cost_per_employee ← v_finance_cost_per_employee: floor(net accrual ÷ active headcount) per period. The
// view already divides+floors; the org-level (no group) branch returns the CUMULATIVE sum of the
// per-period floored per-head costs over the window (headcount is org-constant). NOTE: this is a
// cumulative per-head total, NOT floor(Σaccrual/headcount) — Σₚ floor(aₚ/h) can differ from floor(Σaₚ/h)
// by up to (periods−1) minor units (a sub-unit flooring artifact; each period's value is exact).
// Servable: organization, bonus_period.
// ---------------------------------------------------------------------------
export const COST_PER_EMPLOYEE_SERVABLE: DimensionId[] = ['organization', 'bonus_period'];
export const costPerEmployeeExecutor: MetricExecutor = async (client, plan) => {
  const periodIds = narrowedPeriodIds(plan);
  if (periodIds.length === 0) return [];

  const { data, error } = await client
    .from('v_finance_cost_per_employee')
    .select('bonus_period_id, cost_per_employee_minor')
    .in('bonus_period_id', periodIds);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return []; // role/RLS-denied → honest unavailable

  if (singleGroupDim(plan) === 'bonus_period') {
    return rows
      .filter((r) => r.bonus_period_id)
      .map((r) =>
        makeResult(plan, 'minor_currency', Math.round(num(r.cost_per_employee_minor)), { bonus_period: r.bonus_period_id! }),
      );
  }
  const total = rows.reduce((a, r) => a + num(r.cost_per_employee_minor), 0);
  return [makeResult(plan, 'minor_currency', Math.round(total), {})];
};

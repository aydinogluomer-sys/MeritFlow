// Phase P4 — Module 8-A2 · the final two executors, completing the metric layer (all 11 MetricIds).
// cap_hit_rate reads bonus_allocations (HR/Auditor org-wide per RLS; the service rejects source-
// excluded roles with metric_not_available_for_role — never a silent 0%). dispute_rate reads disputes,
// date-windowed on opened_at, over the scored population. Both parameterized, deterministic (§26); the
// RLS user client scopes every read.
import type { DimensionId } from '../../dimensions/dimension-catalog';
import type { MetricResult } from '../metric-result';
import {
  makeResult,
  narrowedPeriodIds,
  round,
  endExclusiveIso,
  filterValuesFor,
  type MetricExecutor,
  type ResolvedPlan,
} from './types';

/** Roles whose RLS can read bonus_allocations org-wide (0013 SELECT policy). cap_hit_rate is HR/policy audience (§10.6). */
export const CAP_HIT_ALLOCATION_ROLES: ReadonlySet<string> = new Set(['hr', 'auditor']);

// ---------------------------------------------------------------------------
// cap_hit_rate (percent) ← bonus_allocations: count(cap_applied='yes') / count(*) for the period's
// allocations. Denominator = ALL allocations in scope (incl. 'no' and 'pending_missing_cap_basis');
// numerator = 'yes'. A slice with no allocations is OMITTED. Servable: org, bonus_period, team
// (primary_team_id), role (memberships.primary_role join — HR/Auditor can read the roster, 0007).
// The Finance/source-excluded reject is enforced by the service via availableRoles (registry.ts).
// ---------------------------------------------------------------------------
export const CAP_HIT_RATE_SERVABLE: DimensionId[] = ['organization', 'bonus_period', 'team', 'role'];

function singleGroupDim(plan: ResolvedPlan): DimensionId | null {
  return plan.groupBy[0] ?? null;
}

export const capHitRateExecutor: MetricExecutor = async (client, plan) => {
  const periodIds = narrowedPeriodIds(plan);
  if (periodIds.length === 0) return [];

  let q = client
    .from('bonus_allocations')
    .select('cap_applied, primary_team_id, employee_id, bonus_period_id')
    .eq('organization_id', plan.organizationId)
    .in('bonus_period_id', periodIds);
  const teamFilter = filterValuesFor(plan, 'team');
  if (teamFilter) q = q.in('primary_team_id', teamFilter);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{ cap_applied: string; primary_team_id: string | null; employee_id: string; bonus_period_id: string }>;

  const groupDim = singleGroupDim(plan);

  // role grouping needs each employee's primary_role (roster read; HR/Auditor-visible).
  let roleByEmployee: Map<string, string> | null = null;
  if (groupDim === 'role') {
    const { data: mem, error: memErr } = await client
      .from('memberships')
      .select('profile_id, primary_role')
      .eq('organization_id', plan.organizationId);
    if (memErr) throw memErr;
    roleByEmployee = new Map((mem ?? []).map((m) => [(m as { profile_id: string }).profile_id, (m as { primary_role: string }).primary_role]));
  }

  const keyOf = (r: { primary_team_id: string | null; employee_id: string; bonus_period_id: string }): string | null => {
    if (groupDim === 'bonus_period') return r.bonus_period_id;
    if (groupDim === 'team') return r.primary_team_id;
    if (groupDim === 'role') return roleByEmployee?.get(r.employee_id) ?? null;
    return null;
  };

  const agg = new Map<string | null, { yes: number; total: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    if (groupDim && k === null) continue; // cannot group by an absent team/role
    const cur = agg.get(k) ?? { yes: 0, total: 0 };
    cur.total += 1;
    if (r.cap_applied === 'yes') cur.yes += 1;
    agg.set(k, cur);
  }

  const results: MetricResult[] = [];
  for (const [k, { yes, total }] of agg) {
    if (total === 0) continue;
    const dimensions: Record<string, string> = groupDim && k !== null ? { [groupDim]: k } : {};
    results.push(makeResult(plan, 'percent', round((yes / total) * 100, 2), dimensions));
  }
  return results;
};

// ---------------------------------------------------------------------------
// dispute_rate (percent) ← disputes, date-windowed on opened_at ∈ [start, end+1d), over the scored
// population: count(disputes [by dispute_type]) / count(DISTINCT employees with a 'task_approved'
// point_ledger entry in the window) · 100. Population 0 → OMITTED (also yields no result for a
// source-excluded caller, whose point_ledger read is RLS-empty — no fabricated value). Servable:
// org, dispute_type. Period is the SELECTOR window; the registry is trimmed so bonus_period/team/
// policy_version (unbacked by the disputes schema) are rejected by the P0 validator.
// ---------------------------------------------------------------------------
export const DISPUTE_RATE_SERVABLE: DimensionId[] = ['organization', 'dispute_type'];

export const disputeRateExecutor: MetricExecutor = async (client, plan) => {
  const startExclusiveEnd = endExclusiveIso(plan.period.end);

  // Denominator: distinct employees with approved work in the window (scored population).
  const { data: scored, error: scoredErr } = await client
    .from('point_ledger')
    .select('employee_id')
    .eq('organization_id', plan.organizationId)
    .eq('event_type', 'task_approved')
    .gte('created_at', plan.period.start)
    .lt('created_at', startExclusiveEnd);
  if (scoredErr) throw scoredErr;
  const population = new Set((scored ?? []).map((r) => (r as { employee_id: string }).employee_id));
  if (population.size === 0) return []; // no scored population → omit

  // Numerator: disputes opened in the window (optionally filtered by dispute_type).
  let dq = client
    .from('disputes')
    .select('dispute_type')
    .eq('organization_id', plan.organizationId)
    .gte('opened_at', plan.period.start)
    .lt('opened_at', startExclusiveEnd);
  const typeFilter = filterValuesFor(plan, 'dispute_type');
  if (typeFilter) dq = dq.in('dispute_type', typeFilter);

  const { data, error } = await dq;
  if (error) throw error;
  const rows = (data ?? []) as Array<{ dispute_type: string }>;

  if (singleGroupDim(plan) === 'dispute_type') {
    const byType = new Map<string, number>();
    for (const r of rows) byType.set(r.dispute_type, (byType.get(r.dispute_type) ?? 0) + 1);
    return Array.from(byType.entries()).map(([type, count]) =>
      makeResult(plan, 'percent', round((count / population.size) * 100, 2), { dispute_type: type }),
    );
  }
  return [makeResult(plan, 'percent', round((rows.length / population.size) * 100, 2), {})];
};

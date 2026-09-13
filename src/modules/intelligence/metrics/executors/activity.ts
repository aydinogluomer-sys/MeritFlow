// Phase P4 — Module 8-A1 · activity-rate executors. manual_override_rate (point_ledger) and
// gaming_flag_rate (anti_gaming_flags ÷ scored population) are org-level rates over the period the
// selector resolves. Both read via the RLS user client (point_ledger / anti_gaming_flags visibility
// applies). Neither serves a group-by in 8-A1 (team/employee need a team_of/memberships join → later).
import type { DimensionId } from '../../dimensions/dimension-catalog';
import { makeResult, round, endExclusiveIso, type MetricExecutor } from './types';

// ---------------------------------------------------------------------------
// manual_override_rate (percent) — of the scoring-relevant point_ledger entries in the window, the
// share that are MANUAL adjustments:
//   numerator   = count(event_type = 'manual_adjustment')
//   denominator = count(event_type ∈ {'task_approved','manual_adjustment'})
// windowed by created_at ∈ [start, end+1d). OMITTED when the denominator is 0. Servable: org.
// (point_ledger.bonus_period_id is NULL for non-dispute events — 0028 — so the period is date-derived.)
// ---------------------------------------------------------------------------
export const MANUAL_OVERRIDE_SERVABLE: DimensionId[] = ['organization'];

export const manualOverrideRateExecutor: MetricExecutor = async (client, plan) => {
  const { data, error } = await client
    .from('point_ledger')
    .select('event_type')
    .eq('organization_id', plan.organizationId)
    .in('event_type', ['task_approved', 'manual_adjustment'])
    .gte('created_at', plan.period.start)
    .lt('created_at', endExclusiveIso(plan.period.end));
  if (error) throw error;
  const rows = (data ?? []) as Array<{ event_type: string }>;

  const denom = rows.length;
  if (denom === 0) return []; // no scoring entries in the window → omit (no misleading 0%)
  const numer = rows.reduce((a, r) => a + (r.event_type === 'manual_adjustment' ? 1 : 0), 0);
  return [makeResult(plan, 'percent', round((numer / denom) * 100, 2), {})];
};

// ---------------------------------------------------------------------------
// gaming_flag_rate (percent) — CONFIRMED anti-gaming flags attributed to the period, over the scored
// population:
//   numerator   = count(DISTINCT subject_employee_id) with a status='confirmed' flag whose
//                 bonus_period_id ∈ the resolved period ids   (0023 period attribution; NULL excluded)
//   denominator = count(DISTINCT employee_id) with a 'task_approved' point_ledger entry in the window
// OMITTED when the scored population is 0. 'confirmed' only (a dismissed flag is not a real signal).
// Servable: org. (team/employee grouping needs a team_of join → 8-A2.)
// ---------------------------------------------------------------------------
export const GAMING_FLAG_SERVABLE: DimensionId[] = ['organization'];

export const gamingFlagRateExecutor: MetricExecutor = async (client, plan) => {
  // Denominator: distinct employees with approved work in the window (the scored population).
  const { data: scored, error: scoredErr } = await client
    .from('point_ledger')
    .select('employee_id')
    .eq('organization_id', plan.organizationId)
    .eq('event_type', 'task_approved')
    .gte('created_at', plan.period.start)
    .lt('created_at', endExclusiveIso(plan.period.end));
  if (scoredErr) throw scoredErr;
  const population = new Set((scored ?? []).map((r) => (r as { employee_id: string }).employee_id));
  if (population.size === 0) return []; // no scored population → omit

  // Numerator: distinct employees with a CONFIRMED flag attributed to the resolved period(s).
  const periodIds = plan.period.bonusPeriodIds;
  const flagged = new Set<string>();
  if (periodIds.length > 0) {
    const { data: flags, error: flagsErr } = await client
      .from('anti_gaming_flags')
      .select('subject_employee_id')
      .eq('organization_id', plan.organizationId)
      .eq('status', 'confirmed')
      .in('bonus_period_id', periodIds);
    if (flagsErr) throw flagsErr;
    for (const r of flags ?? []) flagged.add((r as { subject_employee_id: string }).subject_employee_id);
  }

  return [makeResult(plan, 'percent', round((flagged.size / population.size) * 100, 2), {})];
};

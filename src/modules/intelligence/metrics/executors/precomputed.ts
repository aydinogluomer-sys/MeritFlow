// Phase P4 — Module 8-A1 · pre-computed-read executors. opportunity_index and policy_complexity read
// values that upstream modules (2-A, 4-A) already computed deterministically and stored; 8-A only
// AGGREGATES them (mean / latest) for the requested slice. No re-derivation, no opaque ML (§26).
import type { DimensionId } from '../../dimensions/dimension-catalog';
import type { MetricResult } from '../metric-result';
import { makeResult, narrowedPeriodIds, num, round, filterValuesFor, type MetricExecutor } from './types';

// ---------------------------------------------------------------------------
// opportunity_index (score) ← opportunity_snapshots.opportunity_index (0–100, pre-computed 2-A).
// Aggregation = arithmetic MEAN of NON-NULL indices (suppressed cohorts store NULL and are EXCLUDED,
// §4.5/§17). A slice with no non-null rows is OMITTED (no misleading 0). Servable: org, bonus_period,
// employee. Person-level (employee) is a sensitive dimension gated by the P0 validator upstream.
// ---------------------------------------------------------------------------
export const OPPORTUNITY_INDEX_SERVABLE: DimensionId[] = ['organization', 'bonus_period', 'employee'];

export const opportunityIndexExecutor: MetricExecutor = async (client, plan) => {
  const periodIds = narrowedPeriodIds(plan);
  if (periodIds.length === 0) return [];

  let q = client
    .from('opportunity_snapshots')
    .select('opportunity_index, bonus_period_id, employee_id')
    .eq('organization_id', plan.organizationId)
    .in('bonus_period_id', periodIds)
    .not('opportunity_index', 'is', null);

  const employeeFilter = filterValuesFor(plan, 'employee');
  if (employeeFilter) q = q.in('employee_id', employeeFilter);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{ opportunity_index: number | null; bonus_period_id: string; employee_id: string }>;

  const groupBy = plan.groupBy;
  const groupKey = (r: { bonus_period_id: string; employee_id: string }): string | null => {
    if (groupBy.includes('employee')) return r.employee_id;
    if (groupBy.includes('bonus_period')) return r.bonus_period_id;
    return null; // org-level
  };
  const dimKey: DimensionId | null = groupBy.includes('employee')
    ? 'employee'
    : groupBy.includes('bonus_period')
      ? 'bonus_period'
      : null;

  const buckets = new Map<string | null, number[]>();
  for (const r of rows) {
    if (r.opportunity_index === null) continue;
    const k = groupKey(r);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(num(r.opportunity_index));
  }

  const results: MetricResult[] = [];
  for (const [k, values] of buckets) {
    if (values.length === 0) continue; // omit empty slices
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const dimensions: Record<string, string> = dimKey && k !== null ? { [dimKey]: k } : {};
    results.push(makeResult(plan, 'score', round(mean, 2), dimensions));
  }
  return results;
};

// ---------------------------------------------------------------------------
// policy_complexity (score) ← policy_complexity_evaluations.total_score (pre-computed 4-A/4-B). Not
// period-scoped: keyed on (policy_version_id, rule_set_version). For each policy_version we take the
// LATEST evaluation by evaluated_at (the current complexity). Group by policy_version → one result per
// version; org-level → MEAN of the latest-per-version scores. Servable: org, policy_version. The
// period selector is IGNORED (documented — this metric is policy-scoped, not period-scoped).
// ---------------------------------------------------------------------------
export const POLICY_COMPLEXITY_SERVABLE: DimensionId[] = ['organization', 'policy_version'];

export const policyComplexityExecutor: MetricExecutor = async (client, plan) => {
  let q = client
    .from('policy_complexity_evaluations')
    .select('policy_version_id, total_score, evaluated_at')
    .eq('organization_id', plan.organizationId);

  const versionFilter = filterValuesFor(plan, 'policy_version');
  if (versionFilter) q = q.in('policy_version_id', versionFilter);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{ policy_version_id: string; total_score: number; evaluated_at: string }>;

  // Latest evaluation per policy_version (by evaluated_at desc).
  const latest = new Map<string, { total: number; at: string }>();
  for (const r of rows) {
    const prev = latest.get(r.policy_version_id);
    if (!prev || r.evaluated_at > prev.at) latest.set(r.policy_version_id, { total: num(r.total_score), at: r.evaluated_at });
  }
  if (latest.size === 0) return []; // no evaluations → omit

  if (plan.groupBy.includes('policy_version')) {
    return Array.from(latest.entries()).map(([versionId, v]) =>
      makeResult(plan, 'score', round(v.total, 2), { policy_version: versionId }),
    );
  }
  // org-level: mean of the latest-per-version scores.
  const scores = Array.from(latest.values()).map((v) => v.total);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return [makeResult(plan, 'score', round(mean, 2), {})];
};

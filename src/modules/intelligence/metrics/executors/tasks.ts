// Phase P4 — Module 8-A1 · task-sourced executors. cycle_completion_rate and approval_latency read the
// `tasks` table, DATE-WINDOWED by the resolved period (tasks carry no bonus_period_id — the period is
// derived from server-stamped timestamps against the period's [start, end], half-open [start, end+1d)).
// The period is supplied by the query's period SELECTOR; these metrics do NOT serve bonus_period as a
// group-by (redundant with the selector). Reads run under the RLS user client (task visibility applies).
import type { DimensionId } from '../../dimensions/dimension-catalog';
import type { MetricResult } from '../metric-result';
import { makeResult, round, endExclusiveIso, type MetricExecutor, type ResolvedPlan } from './types';

/** Median (p50) of a numeric sample; null for an empty sample. Even length → mean of the two middles. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** The single group-by dimension for this plan (8-A1 permits at most one), or null for org-level. */
function singleGroupDim(plan: ResolvedPlan): DimensionId | null {
  return plan.groupBy[0] ?? null;
}

// ---------------------------------------------------------------------------
// cycle_completion_rate (percent) — of the tasks that reached a TERMINAL outcome in the window
// (completed_at in [start, end+1d), status ∈ {approved, rejected}), the share that were APPROVED.
//   numerator   = count(status = 'approved')
//   denominator = count(status ∈ {'approved','rejected'})   (both stamp completed_at)
// A slice with no terminal tasks is OMITTED (rate undefined). Servable: org, team (tasks.team_id).
// ---------------------------------------------------------------------------
export const CYCLE_COMPLETION_SERVABLE: DimensionId[] = ['organization', 'team'];

export const cycleCompletionRateExecutor: MetricExecutor = async (client, plan) => {
  const { data, error } = await client
    .from('tasks')
    .select('status, team_id, completed_at')
    .eq('organization_id', plan.organizationId)
    .in('status', ['approved', 'rejected'])
    .not('completed_at', 'is', null)
    .gte('completed_at', plan.period.start)
    .lt('completed_at', endExclusiveIso(plan.period.end));
  if (error) throw error;
  const rows = (data ?? []) as Array<{ status: string; team_id: string; completed_at: string | null }>;

  const groupDim = singleGroupDim(plan);
  const keyOf = (r: { team_id: string }): string | null => (groupDim === 'team' ? r.team_id : null);

  const agg = new Map<string | null, { approved: number; total: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const cur = agg.get(k) ?? { approved: 0, total: 0 };
    cur.total += 1;
    if (r.status === 'approved') cur.approved += 1;
    agg.set(k, cur);
  }

  const results: MetricResult[] = [];
  for (const [k, { approved, total }] of agg) {
    if (total === 0) continue;
    const dimensions: Record<string, string> = groupDim && k !== null ? { [groupDim]: k } : {};
    results.push(makeResult(plan, 'percent', round((approved / total) * 100, 2), dimensions));
  }
  return results;
};

// ---------------------------------------------------------------------------
// approval_latency (duration_ms) — MEDIAN(approved_at − submitted_at) over tasks APPROVED in the window
// (status='approved', approved_at in [start, end+1d), submitted_at not null). approved_at/submitted_at
// are the authoritative server stamps (task_reviews.created_at ≈ approved_at; using the task stamps
// avoids multi-review ambiguity). Negative/invalid deltas are dropped. Servable: org, team, task_type.
// ---------------------------------------------------------------------------
export const APPROVAL_LATENCY_SERVABLE: DimensionId[] = ['organization', 'team', 'task_type'];

export const approvalLatencyExecutor: MetricExecutor = async (client, plan) => {
  const { data, error } = await client
    .from('tasks')
    .select('approved_at, submitted_at, team_id, task_type')
    .eq('organization_id', plan.organizationId)
    .eq('status', 'approved')
    .not('approved_at', 'is', null)
    .not('submitted_at', 'is', null)
    .gte('approved_at', plan.period.start)
    .lt('approved_at', endExclusiveIso(plan.period.end));
  if (error) throw error;
  const rows = (data ?? []) as Array<{ approved_at: string | null; submitted_at: string | null; team_id: string; task_type: string | null }>;

  const groupDim = singleGroupDim(plan);
  const keyOf = (r: { team_id: string; task_type: string | null }): string | null => {
    if (groupDim === 'team') return r.team_id;
    if (groupDim === 'task_type') return r.task_type; // null task_type → its own null bucket, omitted below
    return null;
  };

  const buckets = new Map<string | null, number[]>();
  for (const r of rows) {
    if (!r.approved_at || !r.submitted_at) continue;
    const latency = Date.parse(r.approved_at) - Date.parse(r.submitted_at);
    if (!Number.isFinite(latency) || latency < 0) continue; // drop invalid / clock-skew rows
    const k = keyOf(r);
    if (groupDim === 'task_type' && k === null) continue; // cannot group by an absent task_type
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(latency);
  }

  const results: MetricResult[] = [];
  for (const [k, values] of buckets) {
    const p50 = median(values);
    if (p50 === null) continue;
    const dimensions: Record<string, string> = groupDim && k !== null ? { [groupDim]: k } : {};
    results.push(makeResult(plan, 'duration_ms', Math.round(p50), dimensions));
  }
  return results;
};

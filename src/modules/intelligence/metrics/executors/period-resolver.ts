// Phase P4 — Module 8-A1 · period resolver. Turns a PeriodSelector (and an optional Comparison basis)
// into concrete bonus_period ids + a bounded date window, reading bonus_periods via the RLS user client.
// DETERMINISTIC: relative windows are resolved against the org's bonus_periods ordered by starts_on
// (NOT the wall clock) so the same DB state always yields the same window (reproducibility, §10.20).
import type { PeriodSelector, Comparison } from '../semantic-query';
import { executionError, type ExecutionError } from './errors';
import type { ResolvedPeriod, SupabaseUserClient } from './types';

interface PeriodRow {
  id: string;
  starts_on: string;
  ends_on: string;
}

/** All of the org's bonus periods, newest first (by starts_on). One RLS-scoped read. */
async function listPeriodsDesc(client: SupabaseUserClient, organizationId: string): Promise<PeriodRow[]> {
  const { data, error } = await client
    .from('bonus_periods')
    .select('id, starts_on, ends_on')
    .eq('organization_id', organizationId)
    .order('starts_on', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PeriodRow[];
}

function spanOf(rows: PeriodRow[]): { start: string; end: string } {
  // rows are non-empty here; derive the inclusive [min starts_on, max ends_on] window.
  let start = rows[0]!.starts_on;
  let end = rows[0]!.ends_on;
  for (const r of rows) {
    if (r.starts_on < start) start = r.starts_on;
    if (r.ends_on > end) end = r.ends_on;
  }
  return { start, end };
}

const TRAILING_COUNT: Record<'trailing_3' | 'trailing_6', number> = { trailing_3: 3, trailing_6: 6 };

/**
 * Resolve the primary period window. Returns an ExecutionError (not a throw) for a caller-facing
 * "no such period" so the service can surface it alongside other execution errors.
 */
export async function resolvePeriod(
  client: SupabaseUserClient,
  organizationId: string,
  selector: PeriodSelector,
): Promise<ResolvedPeriod | ExecutionError> {
  if (selector.kind === 'bonus_period') {
    const { data, error } = await client
      .from('bonus_periods')
      .select('id, starts_on, ends_on')
      .eq('organization_id', organizationId)
      .eq('id', selector.bonusPeriodId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return executionError('period_not_found', `bonus_period ${selector.bonusPeriodId} not found`);
    }
    const r = data as PeriodRow;
    return { bonusPeriodIds: [r.id], start: r.starts_on, end: r.ends_on };
  }

  if (selector.kind === 'range') {
    // Periods whose [starts_on, ends_on] OVERLAPS the requested [start, end].
    const { data, error } = await client
      .from('bonus_periods')
      .select('id, starts_on, ends_on')
      .eq('organization_id', organizationId)
      .lte('starts_on', selector.end)
      .gte('ends_on', selector.start);
    if (error) throw error;
    const rows = (data ?? []) as PeriodRow[];
    // The date window is exactly the requested range (date-windowed metrics honor it directly).
    return { bonusPeriodIds: rows.map((r) => r.id), start: selector.start, end: selector.end };
  }

  // relative — resolve against the ordered period list (deterministic, no wall clock).
  const periods = await listPeriodsDesc(client, organizationId);
  if (periods.length === 0) {
    return executionError('period_not_found', 'no bonus periods exist for the organization');
  }
  let slice: PeriodRow[];
  if (selector.trailing === 'current') slice = periods.slice(0, 1);
  else if (selector.trailing === 'previous') slice = periods.slice(1, 2);
  else slice = periods.slice(0, TRAILING_COUNT[selector.trailing]);
  if (slice.length === 0) {
    return executionError('period_not_found', `no period available for relative selector ${selector.trailing}`);
  }
  return { bonusPeriodIds: slice.map((r) => r.id), ...spanOf(slice) };
}

/**
 * Resolve the COMPARISON window relative to the primary selector. Only an ANCHORED (`bonus_period`)
 * selector supports comparison in 8-A1 — the "previous"/"trailing"/"baseline" of a range/relative
 * window is ambiguous, so it is rejected (comparison_not_executable). Returns null when there is no
 * comparable prior period (e.g. the anchor is the earliest period and basis=previous_period).
 */
export async function resolveComparisonPeriod(
  client: SupabaseUserClient,
  organizationId: string,
  selector: PeriodSelector,
  comparison: Comparison,
): Promise<ResolvedPeriod | ExecutionError | null> {
  if (selector.kind !== 'bonus_period') {
    return executionError(
      'comparison_not_executable',
      'comparison requires an anchored bonus_period selector (range/relative is ambiguous)',
    );
  }
  const periods = await listPeriodsDesc(client, organizationId); // newest first
  const idx = periods.findIndex((p) => p.id === selector.bonusPeriodId);
  if (idx === -1) {
    return executionError('period_not_found', `bonus_period ${selector.bonusPeriodId} not found`);
  }
  const older = periods.slice(idx + 1); // strictly-earlier periods, newest-of-those first
  if (older.length === 0) return null; // the anchor is the earliest period — nothing to compare to.

  let slice: PeriodRow[];
  switch (comparison.basis) {
    case 'previous_period':
      slice = older.slice(0, 1);
      break;
    case 'trailing_3':
      slice = older.slice(0, 3);
      break;
    case 'trailing_6':
      slice = older.slice(0, 6);
      break;
    case 'baseline':
      slice = older.slice(-1); // the earliest period
      break;
  }
  if (slice.length === 0) return null;
  return { bonusPeriodIds: slice.map((r) => r.id), ...spanOf(slice) };
}

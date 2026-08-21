/**
 * MeritFlow period boundary contract (ENGINEERING-24).
 *
 * bonus_periods.starts_on  DATE  — period starts at the BEGINNING of this calendar day (00:00:00 UTC).
 * bonus_periods.ends_on    DATE  — period ends at the END of this calendar day (23:59:59.999 UTC).
 *
 * DB comparisons use SQL BETWEEN (INCLUSIVE both ends): starts_on ≤ date ≤ ends_on. At the timestamp
 * level this equals [starts_on 00:00:00, (ends_on + 1 day) 00:00:00). The spec's "[start, end)"
 * half-open framing and the DB's DATE-level inclusive BETWEEN describe the SAME window — this is a
 * documentation reconciliation, not a behavioral change (migrations 0020/0021/0024 use BETWEEN).
 *
 * Timeliness scoring (AD4): computed by the DB trigger (score_task_on_approve, migration 0020) from
 * the task's submitted timestamp vs this boundary. A LATE APPROVAL never penalises the employee
 * (timeliness is measured at submit, not approve). No JavaScript clock participates in scoring.
 *
 * Browser/client clocks are NEVER trusted for period membership or scoring — every boundary check
 * runs server-side in PostgreSQL. The helper below mirrors the DB rule for read-model/display use.
 */
export const PERIOD_BOUNDARY_SEMANTICS = {
  // inclusive: a task dated on starts_on OR ends_on is IN the period.
  inclusiveBothEnds: true,
  dbComparison: 'BETWEEN starts_on AND ends_on',
  timezone: 'UTC',
} as const;

export type PeriodBoundary = {
  startsOn: string; // ISO date 'YYYY-MM-DD'
  endsOn: string; // ISO date 'YYYY-MM-DD'
};

/**
 * True when the given instant's UTC calendar day falls within the period (inclusive both ends).
 * Mirrors the DB `BETWEEN starts_on AND ends_on`; for display/read-model only — the DB remains the
 * source of truth for membership + scoring.
 */
export function isInPeriod(utcDate: Date, period: PeriodBoundary): boolean {
  const d = utcDate.toISOString().slice(0, 10); // 'YYYY-MM-DD' (UTC)
  return d >= period.startsOn && d <= period.endsOn;
}

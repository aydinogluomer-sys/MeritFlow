import type { OpportunitySnapshotRecord } from '@/modules/opportunity-intelligence';

// Pure presentation helpers for the Opportunity UI (Module 2-B). No JSX, no I/O — deterministic given
// their inputs. The UI renders the engine output; it never computes an opportunity score, shows
// compensation, or renders a verdict — every quadrant is an "Investigate" prompt (§4.7/§26).

// X = opportunity_index (high/low split at 50). Y = performance (approved points; high/low at the
// visible median). All four quadrants are "Investigate", never a verdict (§4.7).
export const QUADRANT_LABELS: Record<string, string> = {
  'hi-hi': 'Yüksek fırsat · yüksek performans — İncele',
  'hi-lo': 'Yüksek fırsat · düşük performans — İncele',
  'lo-hi': 'Düşük fırsat · yüksek performans — İncele',
  'lo-lo': 'Düşük fırsat · düşük performans — İncele',
};

export const INSIGHT_STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  calculated: 'Hesaplandı',
  reviewed: 'İncelendi',
  accepted: 'Kabul edildi',
  dismissed: 'Reddedildi',
  applied: 'Uygulandı',
  observed: 'Gözlendi',
  retrospective: 'Retrospektif',
};

export function median(xs: number[]): number {
  const s = xs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export interface QuadrantRow {
  employeeId: string;
  opportunityIndex: number;
  performance: number;
  oppHigh: boolean;
  perfHigh: boolean;
  quadrantKey: string;
  quadrantLabel: string;
}

/** A snapshot is suppressed when the engine returned a null index (small cohort / no active window,
 * §4.5/§17). Suppressed rows are NEVER placed in a quadrant — they surface in a separate group. */
export function isSuppressed(s: OpportunitySnapshotRecord): boolean {
  return s.opportunityIndex === null || s.components?.suppressed === true;
}

/**
 * Split snapshots into quadrant rows (scored) + a suppressed group. Y-split is the median performance
 * over the SCORED, visible set (deterministic). X-split is the fixed 50 midpoint of the 0–100 index.
 */
export function buildQuadrants(
  snapshots: OpportunitySnapshotRecord[],
  perfByEmployee: Map<string, number>,
): { rows: QuadrantRow[]; suppressed: OpportunitySnapshotRecord[] } {
  const suppressed = snapshots.filter(isSuppressed);
  const scored = snapshots.filter((s) => !isSuppressed(s));
  const perfMedian = median(scored.map((s) => perfByEmployee.get(s.employeeId) ?? 0));
  const rows: QuadrantRow[] = scored.map((s) => {
    const performance = perfByEmployee.get(s.employeeId) ?? 0;
    const opportunityIndex = s.opportunityIndex as number;
    const oppHigh = opportunityIndex >= 50;
    const perfHigh = performance >= perfMedian;
    const quadrantKey = `${oppHigh ? 'hi' : 'lo'}-${perfHigh ? 'hi' : 'lo'}`;
    return { employeeId: s.employeeId, opportunityIndex, performance, oppHigh, perfHigh, quadrantKey, quadrantLabel: QUADRANT_LABELS[quadrantKey]! };
  });
  return { rows, suppressed };
}

export interface TeamBalance {
  cohortMedian: number | null; // median opportunity_index of the scored snapshots (null if none)
  scoredCount: number;
  belowCohort: OpportunitySnapshotRecord[]; // index below the median (significantly-below candidates)
}

/** §4.8 Team Opportunity Balance: the cohort median + the employees significantly below it. */
export function teamBalance(snapshots: OpportunitySnapshotRecord[]): TeamBalance {
  const scored = snapshots.filter((s) => !isSuppressed(s));
  if (scored.length === 0) return { cohortMedian: null, scoredCount: 0, belowCohort: [] };
  const cohortMedian = median(scored.map((s) => s.opportunityIndex as number));
  const belowCohort = scored
    .filter((s) => (s.opportunityIndex as number) < cohortMedian)
    .sort((a, b) => (a.opportunityIndex as number) - (b.opportunityIndex as number));
  return { cohortMedian, scoredCount: scored.length, belowCohort };
}

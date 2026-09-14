// Phase P4 (8-B1) — Executive Overview view-model (§10.2). PURE + deterministic (no IO, no server
// imports — type-only), so it is unit-testable against a mocked executeSemanticQuery outcome. Extracts
// the org-level reading (+ comparison delta) for a metric, derives the "What changed?" and "Requires
// attention" sections, and NEVER fabricates a number: a metric the caller's RLS scoped out yields no
// org-level result → the card renders unavailable, not a fake 0.
import type { SemanticQueryOutcome, StoredInsight, PeriodSelector, Comparison } from '@/modules/intelligence';

/**
 * Build the primary-bundle period (+ optional comparison) for a dashboard, given the current
 * bonus_period id. A previous-period COMPARISON is only executable against an ANCHORED bonus_period
 * selector — resolveComparisonPeriod rejects a relative/range selector (comparison_not_executable) and
 * the service fails the WHOLE query. So: anchor to the current period + compare to the previous one when
 * a period exists; otherwise fall back to relative-current WITHOUT comparison (metrics still resolve
 * org-level; there is simply no delta). Spread the result into the SemanticQuery. PURE (no IO).
 */
export function anchoredMetricPeriod(currentPeriodId: string | null): { period: PeriodSelector; comparison?: Comparison } {
  if (currentPeriodId) {
    return {
      period: { kind: 'bonus_period', bonusPeriodId: currentPeriodId },
      comparison: { basis: 'previous_period' },
    };
  }
  return { period: { kind: 'relative', trailing: 'current' } };
}

export interface MetricReading {
  value: number;
  unit: string;
  /** Signed delta vs the comparison basis at the org-level slice, when present. */
  delta?: number;
}

/** Unit-aware display of a metric value (minor_currency → ₺ from kuruş; percent → %; etc.). */
export function formatMetric(value: number, unit: string): { display: string; suffix?: string } {
  switch (unit) {
    case 'percent':
      return { display: value.toLocaleString('tr-TR', { maximumFractionDigits: 2 }), suffix: '%' };
    case 'minor_currency':
      return { display: (value / 100).toLocaleString('tr-TR', { maximumFractionDigits: 0 }), suffix: '₺' };
    case 'duration_ms':
      return { display: Math.round(value / 1000).toLocaleString('tr-TR'), suffix: 'sn' };
    default: // count | score
      return { display: value.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) };
  }
}

/** The org-level (no group-by) reading for a metric in an outcome, or null when absent/non-numeric. */
export function readOrgMetric(outcome: SemanticQueryOutcome, metricId: string): MetricReading | null {
  if (!outcome.ok) return null;
  const mqr = outcome.metrics.find((m) => m.metricId === metricId);
  if (!mqr) return null;
  const orgResult = mqr.results.find((r) => Object.keys(r.dimensions).length === 0);
  if (!orgResult || typeof orgResult.value !== 'number' || !Number.isFinite(orgResult.value)) return null;
  const orgDelta = mqr.comparison?.deltas.find((d) => Object.keys(d.dimensions).length === 0)?.delta;
  const reading: MetricReading = { value: orgResult.value, unit: orgResult.unit };
  if (orgDelta !== undefined) reading.delta = orgDelta;
  return reading;
}

type InsightSeverity = 'info' | 'warning' | 'critical';
const TERMINAL_STATUSES = new Set(['dismissed', 'retrospective']);
const ATTENTION_SEVERITIES = new Set<InsightSeverity>(['warning', 'critical']);

/** Non-terminal, warning/critical insights — the "Requires attention" list (§10.2), highest severity first. */
export function attentionInsights(insights: StoredInsight[]): StoredInsight[] {
  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return insights
    .filter((i) => !TERMINAL_STATUSES.has(i.status) && ATTENTION_SEVERITIES.has(i.severity as InsightSeverity))
    .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
}

/** Count of actionable (non-terminal, critical) insights — the "Critical Exceptions" card value. */
export function criticalExceptionCount(insights: StoredInsight[]): number {
  return insights.filter((i) => !TERMINAL_STATUSES.has(i.status) && i.severity === 'critical').length;
}

export interface ChangeCandidate {
  label: string;
  reading: MetricReading | null;
  unit: string;
  higherIsBetter: boolean;
}
export interface ChangeItem {
  label: string;
  delta: number;
  unit: string;
  higherIsBetter: boolean;
}

/** The "What changed?" section: metrics with a non-zero comparison delta, largest magnitude first. */
export function changesFrom(candidates: ChangeCandidate[]): ChangeItem[] {
  return candidates
    .filter((c): c is ChangeCandidate & { reading: MetricReading } => c.reading?.delta !== undefined && c.reading.delta !== 0)
    .map((c) => ({ label: c.label, delta: c.reading.delta!, unit: c.unit, higherIsBetter: c.higherIsBetter }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

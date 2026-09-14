// Phase P4 (8-C2) — Policy Intelligence view-model (§10.9). PURE + deterministic (no IO, no server
// imports — type-only), unit-testable against a mocked getHealthComparison + getPolicyComplexityTrend.
// It labels/orders the version-vs-version health-dimension deltas and maps the complexity trend to chart
// points — it NEVER fabricates a number (a missing previous version → null deltas, surfaced honestly).
import type { HealthComparison, HealthDimensionKey } from '@/modules/incentive-health';
import type { VersionTrendEntry } from '@/modules/policy-complexity';
import type { TrendPoint } from '@/components/intelligence';

// §10.9 dimension labels (TR). Every health sub-score is 0–100, higher = healthier, so a POSITIVE delta
// = improvement for EVERY dimension (the caller renders direction with higherIsBetter=true — glyph, not
// color-only). override ≈ manager_discretion; concentration ≈ payout_concentration; gaming ≈ resistance.
export const DIMENSION_LABELS: Record<HealthDimensionKey, string> = {
  payout_concentration: 'Ödeme Yoğunlaşması',
  manager_discretion: 'Yönetici Takdiri (override)',
  gaming_resistance: 'Oyunlaştırma Direnci',
  dispute_exposure: 'İtiraz Maruziyeti',
  complexity: 'Karmaşıklık',
  financial_integrity: 'Finansal Bütünlük',
};

// §10.9 comparison order (dispute / gaming / override / complexity / concentration), then the bonus
// financial-integrity dimension.
export const DIMENSION_ORDER: HealthDimensionKey[] = [
  'dispute_exposure',
  'gaming_resistance',
  'manager_discretion',
  'complexity',
  'payout_concentration',
  'financial_integrity',
];

export interface ComparisonRow {
  key: HealthDimensionKey;
  label: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
}

/**
 * Ordered, labeled version-vs-version rows from a HealthComparison (§10.9 order; any unknown dimension
 * is appended so nothing is silently dropped). Pure. Higher = healthier for every dimension → a positive
 * delta is an improvement (render with higherIsBetter=true). A null delta = no comparable previous value.
 */
export function comparisonRows(comparison: HealthComparison): ComparisonRow[] {
  const byKey = new Map<HealthDimensionKey, HealthComparison['dimensions'][number]>();
  for (const d of comparison.dimensions) byKey.set(d.dimension, d);
  const ordered: HealthDimensionKey[] = [
    ...DIMENSION_ORDER.filter((k) => byKey.has(k)),
    ...comparison.dimensions.map((d) => d.dimension).filter((k) => !DIMENSION_ORDER.includes(k)),
  ];
  return ordered.map((key) => {
    const d = byKey.get(key)!;
    return { key, label: DIMENSION_LABELS[key] ?? key, current: d.current, previous: d.previous, delta: d.delta };
  });
}

/** A 0–100 health/complexity score for display; null (no comparable value) → em dash, never a fake 0. */
export function formatScore(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
}

/** Complexity/debt total across a policy's versions → TrendChart points (ascending version). Pure. */
export function complexityTrendPoints(trend: VersionTrendEntry[]): TrendPoint[] {
  return [...trend]
    .sort((a, b) => a.versionNo - b.versionNo)
    .map((v) => ({ label: `v${v.versionNo}`, value: v.totalScore }));
}

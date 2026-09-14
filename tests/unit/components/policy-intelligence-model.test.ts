import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  comparisonRows,
  complexityTrendPoints,
  formatScore,
  DIMENSION_LABELS,
  DIMENSION_ORDER,
} from '@/components/features/policy-intelligence/model';
import type { HealthComparison } from '@/modules/incentive-health';
import type { VersionTrendEntry } from '@/modules/policy-complexity';

// Phase P4 (8-C2) — pure Policy Intelligence view-model (§10.9). Proves the version-vs-version comparison
// is labeled/ordered deterministically, the "need ≥2 versions" path keeps null deltas (never fabricated),
// and the complexity trend maps to ascending chart points.

function comparison(over: Partial<HealthComparison> = {}): HealthComparison {
  return {
    currentVersionNo: 3,
    previousVersionNo: 2,
    hasPrevious: true,
    overall: { current: 80, previous: 75, delta: 5 },
    dimensions: [
      { dimension: 'payout_concentration', current: 70, previous: 60, delta: 10 },
      { dimension: 'manager_discretion', current: 65, previous: 68, delta: -3 },
      { dimension: 'gaming_resistance', current: 90, previous: 90, delta: 0 },
      { dimension: 'dispute_exposure', current: 55, previous: 50, delta: 5 },
      { dimension: 'complexity', current: 40, previous: 45, delta: -5 },
      { dimension: 'financial_integrity', current: 100, previous: 100, delta: 0 },
    ],
    ...over,
  };
}

describe('comparisonRows (§10.9 version-vs-version)', () => {
  it('orders by the §10.9 dimension order and labels each dimension', () => {
    const rows = comparisonRows(comparison());
    expect(rows.map((r) => r.key)).toEqual(DIMENSION_ORDER);
    expect(rows.map((r) => r.key)).toEqual([
      'dispute_exposure',
      'gaming_resistance',
      'manager_discretion',
      'complexity',
      'payout_concentration',
      'financial_integrity',
    ]);
    expect(rows[0]).toMatchObject({ label: 'İtiraz Maruziyeti', current: 55, previous: 50, delta: 5 });
    expect(rows.every((r) => r.label === DIMENSION_LABELS[r.key])).toBe(true);
  });
  it('carries the exact deltas (higher = healthier; positive = improvement, negative = regression)', () => {
    const byKey = Object.fromEntries(comparisonRows(comparison()).map((r) => [r.key, r.delta]));
    expect(byKey.payout_concentration).toBe(10);
    expect(byKey.manager_discretion).toBe(-3);
    expect(byKey.complexity).toBe(-5);
  });
  it('need ≥2 versions: hasPrevious=false → previous/delta stay null (never a fabricated 0), current kept', () => {
    const rows = comparisonRows(
      comparison({
        hasPrevious: false,
        previousVersionNo: null,
        overall: { current: 80, previous: null, delta: null },
        dimensions: [{ dimension: 'complexity', current: 40, previous: null, delta: null }],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'complexity', current: 40, previous: null, delta: null });
  });
});

describe('complexityTrendPoints', () => {
  it('maps VersionTrendEntry[] to ascending-version chart points (label v{n}, value totalScore)', () => {
    const trend: VersionTrendEntry[] = [
      { policyVersionId: 'c', versionNo: 3, staticScore: 20, runtimeScore: 10, totalScore: 30, deltaTotal: 5 },
      { policyVersionId: 'a', versionNo: 1, staticScore: 10, runtimeScore: 0, totalScore: 10, deltaTotal: 0 },
      { policyVersionId: 'b', versionNo: 2, staticScore: 15, runtimeScore: 10, totalScore: 25, deltaTotal: 15 },
    ];
    expect(complexityTrendPoints(trend)).toEqual([
      { label: 'v1', value: 10 },
      { label: 'v2', value: 25 },
      { label: 'v3', value: 30 },
    ]);
  });
  it('empty trend → [] (honest EmptyState, never a fabricated point)', () => {
    expect(complexityTrendPoints([])).toEqual([]);
  });
});

describe('formatScore', () => {
  it('null → em dash (never a fake 0); a number → localized', () => {
    expect(formatScore(null)).toBe('—');
    expect(formatScore(70)).toBe('70');
  });
});

describe('policy-intelligence page — gating, sources, no-duplication (AD1 / §26 / §23)', () => {
  const src = readFileSync(join(process.cwd(), 'app/(app)/policy-intelligence/page.tsx'), 'utf8');
  it('gates on intelligence.read + the intelligence flag, redirecting unauthorized (deny path)', () => {
    expect(src).toContain("hasPermission('intelligence.read')");
    expect(src).toContain("isEnabled('intelligence')");
    expect(src).toContain("redirect('/unauthorized')");
  });
  it('reuses the engine barrels (no raw SQL/LLM §26) and never the admin client', () => {
    expect(src).toContain('getHealthComparison');
    expect(src).toContain('getPolicyComplexityTrend');
    expect(src).not.toContain('createAdminClient');
  });
  it('cross-links to the detail pages and does NOT re-implement them (§23)', () => {
    expect(src).toContain('/policy-health');
    expect(src).toContain('/policy-debt');
    expect(src).toContain('/policy-impact');
  });
});

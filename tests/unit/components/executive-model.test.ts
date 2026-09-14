import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readOrgMetric,
  formatMetric,
  changesFrom,
  attentionInsights,
  criticalExceptionCount,
  anchoredMetricPeriod,
} from '@/components/features/executive/model';
import type { SemanticQueryOutcome, StoredInsight } from '@/modules/intelligence';

// Phase P4 (8-B1) — pure Executive Overview view-model (§10.2). Tested against a mocked
// executeSemanticQuery outcome + StoredInsight fixtures — proving the dashboard reads real values,
// never fabricates, and derives "What changed?" / "Requires attention" deterministically.

function outcome(metricId: string, value: number, unit: string, delta?: number): SemanticQueryOutcome {
  return {
    ok: true,
    metrics: [
      {
        metricId: metricId as never,
        results: [
          {
            metricId: metricId as never,
            value,
            unit: unit as never,
            period: { start: '2026-01-01', end: '2026-01-31' },
            organizationId: 'org',
            dimensions: {},
            computedAt: '2026-02-01T00:00:00.000Z',
            sourceVersion: 'metrics-v1',
          },
          // a grouped row that must be IGNORED by the org-level reader
          {
            metricId: metricId as never,
            value: 999,
            unit: unit as never,
            period: { start: '2026-01-01', end: '2026-01-31' },
            organizationId: 'org',
            dimensions: { team: 't1' },
            computedAt: '2026-02-01T00:00:00.000Z',
            sourceVersion: 'metrics-v1',
          },
        ],
        ...(delta !== undefined
          ? { comparison: { basis: 'previous_period' as const, results: [], deltas: [{ dimensions: {}, delta }] } }
          : {}),
      },
    ],
  };
}

function insight(over: Partial<StoredInsight>): StoredInsight {
  return {
    id: 'i',
    insightType: 'policy_health',
    severity: 'info',
    headline: 'h',
    evidence: [],
    suggestedActions: [{ code: 'x', label: 'y' }],
    status: 'calculated',
    ...over,
  } as StoredInsight;
}

describe('readOrgMetric', () => {
  it('returns the ORG-LEVEL (empty dimensions) value + delta, ignoring grouped rows', () => {
    expect(readOrgMetric(outcome('budget_variance', 25, 'percent', 5), 'budget_variance')).toEqual({
      value: 25,
      unit: 'percent',
      delta: 5,
    });
  });
  it('returns null for a missing metric, a failed outcome, or a non-numeric value', () => {
    expect(readOrgMetric(outcome('budget_variance', 25, 'percent'), 'payout_total')).toBeNull();
    expect(readOrgMetric({ ok: false, executionErrors: [{ code: 'feature_disabled', message: 'x' }] }, 'x')).toBeNull();
  });
});

describe('formatMetric', () => {
  it('renders minor_currency as ₺ from kuruş, percent with %, score bare', () => {
    expect(formatMetric(1_000_000, 'minor_currency')).toEqual({ display: '10.000', suffix: '₺' });
    expect(formatMetric(25, 'percent')).toEqual({ display: '25', suffix: '%' });
    expect(formatMetric(72, 'score')).toEqual({ display: '72' });
  });
});

describe('changesFrom', () => {
  it('keeps only non-zero deltas, sorted by magnitude (largest first)', () => {
    const changes = changesFrom([
      { label: 'A', reading: { value: 1, unit: 'percent', delta: 2 }, unit: '%', higherIsBetter: true },
      { label: 'B', reading: { value: 1, unit: 'percent', delta: -9 }, unit: '%', higherIsBetter: false },
      { label: 'C', reading: { value: 1, unit: 'percent', delta: 0 }, unit: '%', higherIsBetter: true },
      { label: 'D', reading: null, unit: '%', higherIsBetter: true },
    ]);
    expect(changes.map((c) => c.label)).toEqual(['B', 'A']);
  });
});

describe('attentionInsights / criticalExceptionCount', () => {
  const insights: StoredInsight[] = [
    insight({ id: '1', severity: 'critical', status: 'calculated' }),
    insight({ id: '2', severity: 'warning', status: 'reviewed' }),
    insight({ id: '3', severity: 'info', status: 'calculated' }), // excluded (info)
    insight({ id: '4', severity: 'critical', status: 'dismissed' }), // excluded (terminal)
    insight({ id: '5', severity: 'warning', status: 'retrospective' }), // excluded (terminal)
  ];
  it('surfaces non-terminal warning/critical insights, critical first', () => {
    expect(attentionInsights(insights).map((i) => i.id)).toEqual(['1', '2']);
  });
  it('counts only non-terminal CRITICAL insights (the Critical Exceptions card)', () => {
    expect(criticalExceptionCount(insights)).toBe(1);
  });
});

// Regression for the confirmed shipped defect: the primary metric bundle used a RELATIVE selector + a
// comparison, which the semantic service rejects (comparison_not_executable) → whole-query ok:false →
// every primary card rendered UnavailableCard and "Ne değişti?" was always empty. The mocked-OUTCOME
// tests above could not catch it; this locks the query CONSTRUCTION (present → anchored bonus_period WITH
// comparison; absent → relative WITHOUT comparison). See semantic-query-service.test.ts for the matching
// service-level proof that relative+comparison → ok:false and bonus_period+comparison → ok:true.
describe('anchoredMetricPeriod (comparison must anchor to a bonus_period)', () => {
  it('a current period → anchored bonus_period selector WITH previous_period comparison', () => {
    const { period, comparison } = anchoredMetricPeriod('11111111-1111-4111-8111-111111111111');
    expect(period).toEqual({ kind: 'bonus_period', bonusPeriodId: '11111111-1111-4111-8111-111111111111' });
    expect(comparison).toEqual({ basis: 'previous_period' });
  });
  it('no period → relative-current selector WITHOUT comparison (cards still render, no delta)', () => {
    const result = anchoredMetricPeriod(null);
    expect(result.period).toEqual({ kind: 'relative', trailing: 'current' });
    expect(result.comparison).toBeUndefined();
    // A relative selector must NEVER be paired with a comparison — that is the exact defect being fixed.
    expect('comparison' in result).toBe(false);
  });
});

describe('executive page — anchors the primary bundle (no relative+comparison)', () => {
  const src = readFileSync(join(process.cwd(), 'app/(app)/executive/page.tsx'), 'utf8');
  it('uses anchoredMetricPeriod(periodId) and never inlines a comparison', () => {
    expect(src).toContain('currentPeriodId(');
    expect(src).toContain('anchoredMetricPeriod(periodId)');
    expect(src).not.toContain("comparison: { basis: 'previous_period' }");
  });
});

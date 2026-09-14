import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readOrgMetric,
  formatMetric,
  changesFrom,
  attentionInsights,
  insightBreakdown,
  DEFERRED_OPS_CARDS,
} from '@/components/features/operations/model';
import type { SemanticQueryOutcome, StoredInsight } from '@/modules/intelligence';

// Phase P4 (8-C1) — pure Operations Intelligence view-model (§10.8). Proves the dashboard reads real
// values, never fabricates (SI-12/§23), and derives the exception breakdown deterministically. Operations
// metrics are AGGREGATE process signals — the model never derives a per-employee view.

function outcome(metricId: string, value: number, unit: string): SemanticQueryOutcome {
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
        ],
      },
    ],
  };
}

function insight(over: Partial<StoredInsight>): StoredInsight {
  return {
    id: 'i',
    type: 'policy_health_drift',
    subjectType: 'organization',
    severity: 'info',
    headline: 'h',
    deterministicFacts: {},
    evidence: [],
    suggestedActions: [{ code: 'x', label: 'y' }],
    generatedAt: '2026-01-01T00:00:00.000Z',
    status: 'calculated',
    ...over,
  } as StoredInsight;
}

describe('operations view-model — metric reads (SI-12 honesty)', () => {
  it('reads org-level operations metrics as value/unit', () => {
    expect(readOrgMetric(outcome('cycle_completion_rate', 75, 'percent'), 'cycle_completion_rate')).toMatchObject({ value: 75, unit: 'percent' });
    expect(readOrgMetric(outcome('approval_latency', 4000, 'duration_ms'), 'approval_latency')).toMatchObject({ value: 4000, unit: 'duration_ms' });
  });
  it('a role/RLS-scoped-out (failed or empty) read → null → UnavailableCard, never a fake 0', () => {
    const denied: SemanticQueryOutcome = { ok: false, executionErrors: [{ code: 'feature_disabled', message: 'x' }] };
    expect(readOrgMetric(denied, 'manual_override_rate')).toBeNull();
    const empty: SemanticQueryOutcome = { ok: true, metrics: [{ metricId: 'gaming_flag_rate' as never, results: [] }] };
    expect(readOrgMetric(empty, 'gaming_flag_rate')).toBeNull();
  });
  it('formats approval_latency (duration_ms) as seconds and rates as %', () => {
    expect(formatMetric(4000, 'duration_ms')).toEqual({ display: '4', suffix: 'sn' });
    expect(formatMetric(75, 'percent')).toEqual({ display: '75', suffix: '%' });
  });
});

describe('insightBreakdown (open-exception distribution)', () => {
  it('groups non-terminal warning/critical insights by type, highest count first', () => {
    const insights: StoredInsight[] = [
      insight({ id: '1', type: 'gaming_spike', severity: 'critical', status: 'calculated' }),
      insight({ id: '2', type: 'gaming_spike', severity: 'warning', status: 'reviewed' }),
      insight({ id: '3', type: 'dispute_cluster', severity: 'warning', status: 'calculated' }),
      insight({ id: '4', type: 'gaming_spike', severity: 'info', status: 'calculated' }), // excluded (info)
      insight({ id: '5', type: 'override_burst', severity: 'critical', status: 'dismissed' }), // excluded (terminal)
    ];
    expect(insightBreakdown(insights)).toEqual([
      { label: 'gaming_spike', count: 2 },
      { label: 'dispute_cluster', count: 1 },
    ]);
  });
  it('is empty when nothing requires attention (→ honest EmptyState, not a fabricated bar)', () => {
    expect(insightBreakdown([])).toEqual([]);
    expect(insightBreakdown([insight({ id: '1', severity: 'info', status: 'calculated' })])).toEqual([]);
    // sanity: the breakdown uses the exact attentionInsights filter
    expect(attentionInsights([insight({ id: '1', severity: 'critical', status: 'dismissed' })])).toEqual([]);
  });
});

describe('deferred cards (§10.8 — honest, no fake data)', () => {
  it('defers exactly review-latency / reminder / overdue / recalculation / admin-effort-saved', () => {
    expect(DEFERRED_OPS_CARDS.map((c) => c.label)).toEqual([
      'İnceleme Gecikmesi',
      'Hatırlatma Sayısı',
      'Geciken İşler',
      'Yeniden Hesaplama',
      'Yönetim Eforu Tasarrufu',
    ]);
  });
  it('Admin Effort Saved is deferred with NO hours-saved claim (§10.8)', () => {
    const admin = DEFERRED_OPS_CARDS.find((c) => c.label === 'Yönetim Eforu Tasarrufu')!;
    expect(admin.reason).toContain('metodoloji');
    expect(admin.reason.toLowerCase()).not.toContain('saat kazan');
  });
});

describe('changesFrom (operational deltas)', () => {
  it('keeps only non-zero deltas, largest magnitude first, dropping null readings', () => {
    const changes = changesFrom([
      { label: 'Döngü', reading: { value: 75, unit: 'percent', delta: 3 }, unit: '%', higherIsBetter: true },
      { label: 'Onay', reading: { value: 4000, unit: 'duration_ms', delta: -8 }, unit: 'sn', higherIsBetter: false },
      { label: 'Manuel', reading: null, unit: '%', higherIsBetter: false },
    ]);
    expect(changes.map((c) => c.label)).toEqual(['Onay', 'Döngü']);
  });
});

describe('operations page — server-side gating + privacy (AD1 / SI-12 / CLAUDE.md)', () => {
  const src = readFileSync(join(process.cwd(), 'app/(app)/operations/page.tsx'), 'utf8');
  it('gates on intelligence.read AND the intelligence flag, redirecting unauthorized (deny path)', () => {
    expect(src).toContain("hasPermission('intelligence.read')");
    expect(src).toContain("isEnabled('intelligence')");
    expect(src).toContain("redirect('/unauthorized')");
  });
  it('reads metrics ONLY via executeSemanticQuery (no raw SQL/LLM §26) and never the admin client', () => {
    expect(src).toContain('executeSemanticQuery');
    expect(src).not.toContain('createAdminClient');
  });
  it('is aggregate-only — no employee-level drill affordance (no per-employee surveillance)', () => {
    expect(src).not.toMatch(/level=['"]employee['"]/);
  });
  it('anchors the primary bundle via the shared anchoredMetricPeriod helper (never inline relative+comparison)', () => {
    expect(src).toContain('currentPeriodId(');
    expect(src).toContain('anchoredMetricPeriod(periodId)');
    // The primary bundle must NOT inline a comparison (the helper decides it, only when anchored).
    expect(src).not.toContain("comparison: { basis: 'previous_period' as const }");
  });
  it('converts approval_latency delta ms→sn on BOTH the card and the "Ne değişti?" paths (no 1000× overstate)', () => {
    const occurrences = src.match(/Math\.round\(latency\.delta \/ 1000\)/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
  it('İstisna Hacmi shows unavailable (not a fabricated 0) when the insight-store read fails (SI-12)', () => {
    expect(src).toContain('insightsAvailable');
  });
});

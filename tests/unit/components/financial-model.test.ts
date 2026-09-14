import { describe, expect, it } from 'vitest';
import {
  readOrgMetric,
  formatMetric,
  deriveRollup,
  financialWaterfall,
  binPayouts,
  DEFERRED_MONEY_CARDS,
} from '@/components/features/financial/model';
import type { SemanticQueryOutcome } from '@/modules/intelligence';

// Phase P4 (8-B2) — pure Financial Intelligence view-model (§10.4). Proves roll-ups/derivations are
// correct AND that an RLS-denied (non-finance) read yields an EMPTY/undefined state — the page renders
// "unavailable", NEVER a fabricated 0 (SI-12 honesty; mirrors the 8-B1 payout-trend fix).

describe('deriveRollup', () => {
  it('derives pool/accrued/paid/outstanding/undistributed + pool utilization', () => {
    const r = deriveRollup({
      pool_amount: 8_000_000,
      distributable: 8_000_000,
      total_accrued: 6_000_000,
      total_paid: 4_000_000,
      undistributed_remainder: 2_000_000,
    })!;
    expect(r.pool).toBe(8_000_000);
    expect(r.accrued).toBe(6_000_000);
    expect(r.paid).toBe(4_000_000);
    expect(r.outstanding).toBe(2_000_000); // accrued − paid
    expect(r.poolUtilizationPct).toBe(75); // 6M / 8M · 100
  });
  it('SI-12: a null finance-view row (RLS-denied) → null (→ unavailable card, NOT a fake 0)', () => {
    expect(deriveRollup(null)).toBeNull();
  });
  it('no pool → pool utilization is null (undefined), never a fabricated 0', () => {
    const r = deriveRollup({ pool_amount: 0, distributable: 0, total_accrued: 0, total_paid: 0, undistributed_remainder: 0 })!;
    expect(r.poolUtilizationPct).toBeNull();
  });
});

describe('financialWaterfall', () => {
  it('reconciles by construction: pool → (−notDistributed) → accrued → (−outstanding) → paid', () => {
    const r = deriveRollup({ pool_amount: 8_000_000, distributable: 8_000_000, total_accrued: 6_000_000, total_paid: 4_000_000, undistributed_remainder: 2_000_000 })!;
    const steps = financialWaterfall(r);
    // running total after applying all deltas must equal paid.
    const end = steps.reduce((sum, s) => sum + s.delta, 0);
    expect(end).toBe(4_000_000); // = paid
    expect(steps.map((s) => s.label)).toEqual(['Havuz', 'Dağıtılmayan', 'Bekleyen']);
  });
  it('is empty when there is no pool', () => {
    expect(financialWaterfall(deriveRollup(null))).toEqual([]);
    expect(financialWaterfall(deriveRollup({ pool_amount: 0, distributable: 0, total_accrued: 0, total_paid: 0, undistributed_remainder: 0 }))).toEqual([]);
  });
});

describe('binPayouts', () => {
  it('bins a payout distribution into ranges', () => {
    const bins = binPayouts([10_000, 20_000, 100_000, 200_000], 2); // ÷100 → 100,200,1000,2000 ₺
    expect(bins).toHaveLength(2);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(4);
  });
  it('SI-12: an empty payout read (RLS-denied) → empty bins (→ honest EmptyState, not fabricated)', () => {
    expect(binPayouts([])).toEqual([]);
    expect(binPayouts([0, 0])).toEqual([]); // no positive amounts
  });
});

describe('formatMetric (reused) + deferred cards', () => {
  it('formats minor_currency as ₺ from kuruş', () => {
    expect(formatMetric(10_000_000, 'minor_currency')).toEqual({ display: '100.000', suffix: '₺' });
  });
  it('lists the 5 deferred money-delta enrichment cards (honest, no fake data)', () => {
    expect(DEFERRED_MONEY_CARDS.map((c) => c.label)).toEqual([
      'Cap Para Etkisi',
      'Düzeltme Para Etkisi',
      'İtiraz Finansal Etkisi',
      'Takım Maliyeti',
      'Çalışan Başına Maliyet',
    ]);
  });
});

describe('readOrgMetric (SI-12 honesty on the metric layer)', () => {
  it('a role scoped out (failed/empty outcome) → null → unavailable, never a fake 0', () => {
    const denied: SemanticQueryOutcome = { ok: false, executionErrors: [{ code: 'metric_not_available_for_role', message: 'x' }] };
    expect(readOrgMetric(denied, 'cap_hit_rate')).toBeNull();
    const empty: SemanticQueryOutcome = { ok: true, metrics: [{ metricId: 'payout_total' as never, results: [] }] };
    expect(readOrgMetric(empty, 'payout_total')).toBeNull();
  });
});

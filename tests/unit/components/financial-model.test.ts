import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  it('lists ONLY the 1 still-deferred money card (İtiraz Finansal Etkisi went live via 0051; only Düzeltme remains)', () => {
    expect(DEFERRED_MONEY_CARDS.map((c) => c.label)).toEqual(['Düzeltme Para Etkisi']);
  });
});

describe('8-B4 finance money-delta wiring (readOrgMetric → value/unit; role-denied → null, never a fake 0)', () => {
  // The 3 money-delta metrics are queried in an ISOLATED {hr,finance,auditor} bundle on the page. An
  // authorized read yields org-level minor_currency values → MoneyCard; a role-denied bundle → null for
  // every card → honest UnavailableCard (SI-12/§23), never a fabricated ₺0.
  function moneyOutcome(pairs: Array<[string, number]>): SemanticQueryOutcome {
    return {
      ok: true,
      metrics: pairs.map(([metricId, value]) => ({
        metricId: metricId as never,
        results: [
          {
            metricId: metricId as never,
            value,
            unit: 'minor_currency',
            period: { start: '2026-01-01', end: '2026-01-31' },
            organizationId: 'org',
            dimensions: {},
            computedAt: '2026-02-01T00:00:00.000Z',
            sourceVersion: 'metrics-v1',
          },
        ],
      })),
    };
  }

  it('reads each money-delta metric as an org-level minor_currency value', () => {
    const outcome = moneyOutcome([
      ['cap_money_impact', 1_000_000],
      ['team_cost', 10_000_000],
      ['cost_per_employee', 1_666_666],
      ['dispute_financial_impact', 2_000_000],
    ]);
    expect(readOrgMetric(outcome, 'cap_money_impact')).toMatchObject({ value: 1_000_000, unit: 'minor_currency' });
    expect(readOrgMetric(outcome, 'team_cost')).toMatchObject({ value: 10_000_000, unit: 'minor_currency' });
    expect(readOrgMetric(outcome, 'cost_per_employee')).toMatchObject({ value: 1_666_666, unit: 'minor_currency' });
    // İtiraz Finansal Etkisi (0051) — period-level NET dispute-recalc money, read the same way.
    expect(readOrgMetric(outcome, 'dispute_financial_impact')).toMatchObject({ value: 2_000_000, unit: 'minor_currency' });
    expect(formatMetric(10_000_000, 'minor_currency')).toEqual({ display: '100.000', suffix: '₺' }); // kuruş → ₺
  });

  it('SI-12: a role-denied isolated bundle → null for EVERY money card (→ UnavailableCard, never ₺0)', () => {
    const denied: SemanticQueryOutcome = {
      ok: false,
      executionErrors: [{ code: 'metric_not_available_for_role', message: 'x' }],
    };
    for (const m of ['cap_money_impact', 'team_cost', 'cost_per_employee', 'dispute_financial_impact']) {
      expect(readOrgMetric(denied, m)).toBeNull();
    }
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

describe('financial page — anchors the primary bundle (no relative+comparison)', () => {
  // Regression for the shipped defect: the financeMetrics bundle used a relative selector + comparison,
  // which the service rejects (comparison_not_executable) → whole-query ok:false → every finance card
  // rendered UnavailableCard. It now anchors via anchoredMetricPeriod(periodId).
  const src = readFileSync(join(process.cwd(), 'app/(app)/financial/page.tsx'), 'utf8');
  it('uses anchoredMetricPeriod(periodId) and never inlines a comparison', () => {
    expect(src).toContain('currentPeriodId(');
    expect(src).toContain('anchoredMetricPeriod(periodId)');
    expect(src).not.toContain("comparison: { basis: 'previous_period' }");
  });

  it('wires dispute_financial_impact into the role-isolated money bundle + renders the İtiraz card', () => {
    // Joins the SAME {hr,finance,auditor} isolated bundle as the other money-delta metrics (a reject →
    // null → honest UnavailableCard, never a fake ₺0), and the card is rendered from readOrgMetric.
    expect(src).toContain("'cap_money_impact', 'team_cost', 'cost_per_employee', 'dispute_financial_impact'");
    expect(src).toContain("readOrgMetric(moneyMetrics, 'dispute_financial_impact')");
    expect(src).toContain('İtiraz Finansal Etkisi');
  });
});

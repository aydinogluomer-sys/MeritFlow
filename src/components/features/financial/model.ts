// Phase P4 (8-B2) — Financial Intelligence view-model (§10.4). PURE + deterministic (no IO, no server
// imports — type-only), unit-testable against mocked v_finance_period_totals rows + a mocked
// executeSemanticQuery outcome. Reuses the executive readers (readOrgMetric/formatMetric). All money
// comes from the sanctioned finance views / the metric layer (SI-12) — this module only DERIVES
// (pool-utilization, outstanding, the reconciling waterfall) and NEVER fabricates a number.
import type { WaterfallStep, DistributionBin } from '@/components/intelligence';

export { readOrgMetric, formatMetric, changesFrom, type MetricReading } from '@/components/features/executive/model';

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** The (nullable) columns of a v_finance_period_totals row (SI-12-safe finance view, 0027). */
export interface PeriodTotals {
  pool_amount: number | null;
  distributable: number | null;
  total_accrued: number | null;
  total_paid: number | null;
  undistributed_remainder: number | null;
}

export interface FinancialRollup {
  pool: number;
  distributable: number;
  accrued: number;
  paid: number;
  /** accrued − paid (clamped ≥ 0). */
  outstanding: number;
  undistributed: number;
  /** accrued / pool × 100, or null when there is no pool (undefined — never a fake 0). */
  poolUtilizationPct: number | null;
}

/** Derive the period roll-up from a finance-view row. Null row (RLS-denied / no period) → null. */
export function deriveRollup(t: PeriodTotals | null): FinancialRollup | null {
  if (!t) return null;
  const pool = num(t.pool_amount);
  const accrued = num(t.total_accrued);
  const paid = num(t.total_paid);
  return {
    pool,
    distributable: num(t.distributable),
    accrued,
    paid,
    outstanding: Math.max(0, accrued - paid),
    undistributed: num(t.undistributed_remainder),
    poolUtilizationPct: pool > 0 ? round((accrued / pool) * 100, 2) : null,
  };
}

/**
 * Period money-flow waterfall (§10.16). Each delta is an EXACT difference of two roll-up quantities,
 * so the running total reconciles by construction: pool → (−Dağıtılmayan = pool−accrued) → accrued →
 * (−Bekleyen = accrued−paid) → paid. Empty when there is no pool (nothing to show).
 */
export function financialWaterfall(r: FinancialRollup | null): WaterfallStep[] {
  if (!r || r.pool <= 0) return [];
  const notDistributed = Math.max(0, r.pool - r.accrued);
  return [
    { label: 'Havuz', delta: r.pool },
    { label: 'Dağıtılmayan', delta: -notDistributed },
    { label: 'Bekleyen', delta: -r.outstanding },
  ];
}

/** Bin a per-employee payout distribution (minor currency) into ₺ ranges for the concentration chart. */
export function binPayouts(amountsMinor: number[], bins = 5): DistributionBin[] {
  const positive = amountsMinor.filter((a) => a > 0).map((a) => a / 100);
  if (positive.length === 0) return [];
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  if (max === min) return [{ label: `${Math.round(min).toLocaleString('tr-TR')} ₺`, count: positive.length }];
  const width = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const v of positive) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return counts.map((count, i) => ({
    label: `${Math.round(min + i * width).toLocaleString('tr-TR')}–${Math.round(min + (i + 1) * width).toLocaleString('tr-TR')}`,
    count,
  }));
}

/**
 * The §10.4 money-delta ENRICHMENT cards that require a NEW finance-safe view (out of 8-B2 scope) —
 * rendered as an honest "not yet available" state, NEVER a fabricated number (§23). The 8-B3 finance-
 * metric DB slice will add the backing views.
 */
export interface DeferredCard {
  label: string;
  reason: string;
}
export const DEFERRED_MONEY_CARDS: DeferredCard[] = [
  { label: 'Cap Para Etkisi', reason: 'Σ(cap sonrası − cap öncesi) — SI-12-güvenli bir v_finance görünümü gerekir (8-B3).' },
  { label: 'Düzeltme Para Etkisi', reason: 'Σ manuel/politika düzeltme (₺) — yeni bir v_finance görünümü gerekir (8-B3).' },
  { label: 'İtiraz Finansal Etkisi', reason: 'Duruma göre Σ itiraz tutarı — 7-D + yeni görünüm gerekir (8-B3).' },
  { label: 'Takım Maliyeti', reason: 'payout_total takım boyutunu sunmuyor — v_finance görünümüne takım kolonu gerekir (8-B3).' },
  { label: 'Çalışan Başına Maliyet', reason: 'Kişi başı gider — v_finance dışında bir başlık (headcount) gerekir (8-B3).' },
];

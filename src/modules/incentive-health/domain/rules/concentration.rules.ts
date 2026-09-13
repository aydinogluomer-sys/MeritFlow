// Payout Concentration dimension (§3.2). How unevenly the version's payouts are distributed:
// top-10% share, a Gini-like concentration, and mean/median divergence. Higher concentration ⇒
// lower health. PURE + VERSIONED (§3.5): thresholds live here, never as magic numbers in callers.
import type { ConcentrationSignals, DimensionScore, HealthDriver } from '../types';
import type { EvidenceRef } from '@/modules/intelligence';
import { riskImpact, roundScore, sampleConfidence } from '../score-util';

// Bumping ANY constant below requires bumping HEALTH_RULE_SET_VERSION (persisted evals stay reproducible).
const TOP10_THRESHOLD = 0.5; // healthy while the top 10% of earners take ≤ 50% of the payout
const TOP10_PER_UNIT = 120;
const TOP10_CAP = 45;
const GINI_THRESHOLD = 0.5;
const GINI_PER_UNIT = 120;
const GINI_CAP = 35;
const DIVERGENCE_THRESHOLD = 0.4; // (mean − median) / mean
const DIVERGENCE_PER_UNIT = 80;
const DIVERGENCE_CAP = 20;
const MIN_SAMPLE = 8; // full confidence once ≥ 8 payees are observed

export const CONCENTRATION_RULES = [
  {
    id: 'concentration_top10',
    version: '1',
    label: 'İlk %10 payı',
    rationale: 'İlk %10 kazananın havuzun büyük kısmını alması ödülün az kişide yoğunlaştığını gösterir.',
  },
  {
    id: 'concentration_gini',
    version: '1',
    label: 'Gini benzeri yoğunlaşma',
    rationale: 'Gini benzeri katsayı, ödül dağılımının eşitsizliğini tek bir 0–1 ölçüsünde özetler.',
  },
  {
    id: 'concentration_mean_median',
    version: '1',
    label: 'Ortalama/medyan sapması',
    rationale: 'Ortalamanın medyandan büyük sapması, birkaç yüksek ödülün dağılımı çarpıttığını gösterir.',
  },
] as const;

/** Gini via the sorted mean-absolute-difference form. 0 = perfectly equal, →1 = all to one. */
function gini(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * sorted[i]!;
  return (2 * cum) / (n * total) - (n + 1) / n;
}

/** Share of total payout captured by the top `pct` of earners (k = max(1, round(n·pct))). */
function topShare(values: number[], pct: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const k = Math.max(1, Math.round(n * pct));
  const sorted = [...values].sort((a, b) => b - a);
  const top = sorted.slice(0, k).reduce((a, b) => a + b, 0);
  return top / total;
}

function median(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export function scoreConcentration(s: ConcentrationSignals, evidence: EvidenceRef[]): DimensionScore {
  // Keep legitimate ZERO payouts (guard only non-finite/negative). A version that pays a few people a
  // lot and many people nothing is the exact concentration pathology this dimension exists to catch —
  // dropping the have-nots would make the distribution look artificially equal. gini()/topShare()/
  // median() all guard total ≤ 0, so an all-zero population stays safe (returns 0 ⇒ score 100).
  const values = s.payouts.filter((v) => Number.isFinite(v) && v >= 0);
  const n = values.length;
  const top10 = topShare(values, 0.1);
  const g = gini(values);
  const mean = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0;
  const med = median(values);
  const divergence = mean > 0 ? Math.max(0, (mean - med) / mean) : 0;

  const drivers: HealthDriver[] = [
    {
      code: 'CONCENTRATION_TOP10_HIGH',
      label: 'İlk %10 payı',
      impact: riskImpact(top10, TOP10_THRESHOLD, TOP10_PER_UNIT, TOP10_CAP),
      value: top10,
      threshold: TOP10_THRESHOLD,
    },
    {
      code: 'GINI_HIGH',
      label: 'Gini yoğunlaşması',
      impact: riskImpact(g, GINI_THRESHOLD, GINI_PER_UNIT, GINI_CAP),
      value: g,
      threshold: GINI_THRESHOLD,
    },
    {
      code: 'MEAN_MEDIAN_DIVERGENCE',
      label: 'Ortalama/medyan sapması',
      impact: riskImpact(divergence, DIVERGENCE_THRESHOLD, DIVERGENCE_PER_UNIT, DIVERGENCE_CAP),
      value: divergence,
      threshold: DIVERGENCE_THRESHOLD,
    },
  ];
  const score = roundScore(100 + drivers.reduce((a, d) => a + d.impact, 0));
  return { dimension: 'payout_concentration', score, confidence: sampleConfidence(n, MIN_SAMPLE), drivers, evidence };
}

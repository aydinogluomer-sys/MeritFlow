// Dispute Exposure dimension (§3.2). Historical dispute concentration on the version's outcomes:
// disputes deterministically attributable to the version (polymorphic target → allocation / run /
// point_ledger) relative to the disputable surface, weighting still-open disputes more heavily.
// PURE + VERSIONED (§3.5). More disputes / more unresolved ⇒ lower health.
import type { DimensionScore, DisputeSignals, HealthDriver } from '../types';
import type { EvidenceRef } from '@/modules/intelligence';
import { riskImpact, roundScore, sampleConfidence } from '../score-util';

const RATE_THRESHOLD = 0.05; // healthy while ≤ 5% of disputable targets are disputed
const RATE_PER_UNIT = 240;
const RATE_CAP = 50;
const OPEN_THRESHOLD = 0; // any unresolved dispute adds exposure
const OPEN_PER_UNIT = 10;
const OPEN_CAP = 40;
const MIN_TARGETS = 10; // full confidence once ≥ 10 disputable targets exist

export const DISPUTE_RULES = [
  {
    id: 'dispute_rate',
    version: '1',
    label: 'İtiraz oranı',
    rationale: 'Sürüme atfedilebilen itirazların, itiraz edilebilir sonuç sayısına oranı maruziyeti ölçer.',
  },
  {
    id: 'dispute_open',
    version: '1',
    label: 'Açık itirazlar',
    rationale: 'Hâlâ açık/incelemede olan itirazlar çözülmemiş adalet riskini gösterir.',
  },
] as const;

export function scoreDispute(s: DisputeSignals, evidence: EvidenceRef[]): DimensionScore {
  const targets = Math.max(0, s.scopedTargets);
  const disputes = Math.max(0, s.attributableDisputes);
  const open = Math.max(0, s.openOrUnresolved);
  const rate = targets > 0 ? disputes / targets : 0;

  const drivers: HealthDriver[] = [
    {
      code: 'DISPUTE_RATE_HIGH',
      label: 'İtiraz oranı',
      impact: riskImpact(rate, RATE_THRESHOLD, RATE_PER_UNIT, RATE_CAP),
      value: rate,
      threshold: RATE_THRESHOLD,
    },
    {
      code: 'OPEN_DISPUTES',
      label: 'Açık itirazlar',
      impact: riskImpact(open, OPEN_THRESHOLD, OPEN_PER_UNIT, OPEN_CAP),
      value: open,
      threshold: OPEN_THRESHOLD,
    },
  ];
  const score = roundScore(100 + drivers.reduce((a, d) => a + d.impact, 0));
  return { dimension: 'dispute_exposure', score, confidence: sampleConfidence(targets, MIN_TARGETS), drivers, evidence };
}

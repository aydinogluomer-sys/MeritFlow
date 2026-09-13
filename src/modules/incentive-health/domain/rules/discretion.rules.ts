// Manager Discretion dimension (§3.2). How much of the version's outcome is shaped by manual
// overrides vs the objective scored work — a high manual-adjustment share signals discretionary,
// less-explainable pay. PURE + VERSIONED (§3.5). Higher override share ⇒ lower health.
import type { DimensionScore, DiscretionSignals, HealthDriver } from '../types';
import type { EvidenceRef } from '@/modules/intelligence';
import { riskImpact, roundScore, sampleConfidence } from '../score-util';

const SHARE_THRESHOLD = 0.15; // healthy while manual overrides are ≤ 15% of scored magnitude
const SHARE_PER_UNIT = 260;
const SHARE_CAP = 70;
const MIN_ACTIVITY = 20; // full confidence once ≥ 20 scored/override events are observed

export const DISCRETION_RULES = [
  {
    id: 'discretion_override_share',
    version: '1',
    label: 'Manuel override payı',
    rationale:
      'Sürümün toplam puan büyüklüğünün ne kadarının (göreve bağlı) manuel düzeltmelerden geldiğini ' +
      'ölçer; yüksek pay, sonucun objektif puandan çok takdirle şekillendiğini gösterir (§3.2). ' +
      'Görevle ilişkilendirilmemiş manuel düzeltmeler sürüme atfedilemez (bkz. repository başlığı).',
  },
] as const;

export function scoreDiscretion(s: DiscretionSignals, evidence: EvidenceRef[]): DimensionScore {
  const scored = Math.max(0, s.scoredPoints);
  const override = Math.max(0, s.overrideMagnitude);
  const denom = scored + override;
  const share = denom > 0 ? override / denom : 0;

  const drivers: HealthDriver[] = [
    {
      code: 'OVERRIDE_SHARE_HIGH',
      label: 'Manuel override payı',
      impact: riskImpact(share, SHARE_THRESHOLD, SHARE_PER_UNIT, SHARE_CAP),
      value: share,
      threshold: SHARE_THRESHOLD,
    },
  ];
  const score = roundScore(100 + drivers.reduce((a, d) => a + d.impact, 0));
  // Confidence scales with the number of observed point events (scored + override rows).
  const events = Math.max(0, s.scoredCount) + Math.max(0, s.overrideCount);
  return {
    dimension: 'manager_discretion',
    score,
    confidence: sampleConfidence(events, MIN_ACTIVITY),
    drivers,
    evidence,
  };
}

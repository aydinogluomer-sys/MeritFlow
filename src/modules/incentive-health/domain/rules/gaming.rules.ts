// Gaming Resistance dimension (§3.2, rendered as "resistance" in §3.3 — higher = safer). 1-A uses the
// CONFIG-DERIVED threshold-cliff signal (a small score change flipping a large payout is the classic
// gameable structure) computed via Module 4's cliff logic. Operational anti-gaming signals (reviewer
// concentration, end-period spike, tiny-task splitting) are DEFERRED: anti_gaming_flags has no clean
// deterministic link to a policy version (no version/period FK) — see the module README / audit §D.
// PURE + VERSIONED (§3.5). More cliffs ⇒ lower resistance.
import type { DimensionScore, GamingSignals, HealthDriver } from '../types';
import type { EvidenceRef } from '@/modules/intelligence';
import { riskImpact, roundScore } from '../score-util';

const CLIFF_THRESHOLD = 0; // any cliff is a gameable boundary
const CLIFF_PER_UNIT = 16; // health cost per detected cliff
const CLIFF_CAP = 80;

export const GAMING_RULES = [
  {
    id: 'gaming_threshold_cliff',
    version: '1',
    label: 'Eşik uçurumları',
    rationale:
      'Bitişik kovalar arasındaki büyük çarpan sıçramaları (Modül 4 uçurum tespiti), küçük bir puan ' +
      'farkının ödülü büyük ölçüde değiştirdiği ve manipülasyona açık yapıları işaret eder (§3.2/§3.7).',
  },
] as const;

export function scoreGaming(s: GamingSignals, evidence: EvidenceRef[]): DimensionScore {
  const cliffs = Math.max(0, s.cliffCount);
  const drivers: HealthDriver[] = [
    {
      code: 'THRESHOLD_CLIFF',
      label: 'Eşik uçurumları',
      impact: riskImpact(cliffs, CLIFF_THRESHOLD, CLIFF_PER_UNIT, CLIFF_CAP),
      value: cliffs,
      threshold: CLIFF_THRESHOLD,
    },
  ];
  const score = roundScore(100 + drivers.reduce((a, d) => a + d.impact, 0));
  // The cliff signal is derived from the policy config, which is always fully available ⇒ confidence 1.
  return { dimension: 'gaming_resistance', score, confidence: 1, drivers, evidence };
}

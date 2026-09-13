// Complexity dimension (§3.2 + §12.4 "Complexity feeds Health"). Reuses Module 4's DETERMINISTIC
// static-complexity score (config-derived, always available) and normalizes it to a health sub-score:
// a small "free" allowance of structural complexity is healthy; beyond it, each point of complexity
// debt lowers health. PURE + VERSIONED (§3.5). Higher complexity ⇒ lower health.
import type { ComplexitySignals, DimensionScore, HealthDriver } from '../types';
import type { EvidenceRef } from '@/modules/intelligence';
import { riskImpact, roundScore } from '../score-util';

const FREE_ALLOWANCE = 20; // structural complexity up to this is considered healthy
const PER_UNIT = 1.5; // health cost per complexity point beyond the allowance
const CAP = 70;

export const COMPLEXITY_RULES = [
  {
    id: 'complexity_debt',
    version: '1',
    label: 'Karmaşıklık borcu',
    rationale:
      'Modül 4 statik karmaşıklık skoru (boyut/kova/uçurum/ceza/eşik sürücüleri) sağlıklı bir ' +
      'serbestlik payının üzerine çıktıkça politikayı akıl yürütmesi ve sürdürmesi zorlaşır (§12.4).',
  },
] as const;

export function scoreComplexity(s: ComplexitySignals, evidence: EvidenceRef[]): DimensionScore {
  const complexity = Math.max(0, s.staticScore);
  const drivers: HealthDriver[] = [
    {
      code: 'COMPLEXITY_DEBT',
      label: 'Karmaşıklık borcu',
      impact: riskImpact(complexity, FREE_ALLOWANCE, PER_UNIT, CAP),
      value: complexity,
      threshold: FREE_ALLOWANCE,
    },
  ];
  const score = roundScore(100 + drivers.reduce((a, d) => a + d.impact, 0));
  // Static complexity is derived from the version config, always available ⇒ confidence 1.
  return { dimension: 'complexity', score, confidence: 1, drivers, evidence };
}

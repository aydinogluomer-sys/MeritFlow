// Financial Integrity dimension (§3.2) — the most safety-critical. Over the version's completed runs:
// pool conservation (Σ allocations + undistributed_remainder must equal the declared pool) and missing
// cap basis (AD6 pending — the observable cap-enforcement risk). PURE + VERSIONED (§3.5). A
// conservation breach is a hard integrity failure ⇒ steep drop.
//
// NOTE (cap enforcement): literal cap OVERFLOW (a final amount exceeding its applied cap) is structurally
// impossible in persisted data — the DB CHECK bonus_allocations_cap_not_exceeded_chk (migration 0013)
// guarantees cap_applied='yes' ⇒ final_amount_minor ≤ cap_minor. A health driver for it would be
// permanently dead (always 0), so it is intentionally NOT modeled here (cf. the removed 4-B dead
// dispute signal). The observable cap-enforcement risk is a cap that COULDN'T be enforced because the
// basis is missing (AD6) → export blocked; that is the MISSING_CAP_BASIS driver below.
import type { DimensionScore, FinancialIntegritySignals, HealthDriver } from '../types';
import type { EvidenceRef } from '@/modules/intelligence';
import { riskImpact, roundScore, sampleConfidence } from '../score-util';

const CONSERVATION_PER_UNIT = 45; // per breaching pool (a serious, must-not-happen integrity fault)
const CONSERVATION_CAP = 90;
const MISSING_BASIS_PER_UNIT = 6; // per allocation blocked on a missing cap basis (AD6 — reportable)
const MISSING_BASIS_CAP = 30;
const MIN_ALLOCATIONS = 5; // full confidence once ≥ 5 allocations are observed

export const FINANCIAL_INTEGRITY_RULES = [
  {
    id: 'fi_pool_conservation',
    version: '1',
    label: 'Havuz korunumu',
    rationale:
      'Σ tahsis + dağıtılmayan kalan = ilan edilen havuz olmalı (INV-4). İhlal, parasal bir tutarsızlıktır.',
  },
  {
    id: 'fi_missing_cap_basis',
    version: '1',
    label: 'Eksik tavan tabanı',
    rationale:
      'Tavan tabanı eksik tahsisler (AD6) tavanın uygulanamamasına ve export’un bloke olmasına yol açar; ' +
      'gözlemlenebilir tavan-uygulama riskidir. (Tavan aşımı DB CHECK ile yapısal olarak engellenir.)',
  },
] as const;

export function scoreFinancialIntegrity(
  s: FinancialIntegritySignals,
  evidence: EvidenceRef[],
): DimensionScore {
  const breaches = s.pools.filter((p) => p.allocated + p.undistributed !== p.declared).length;
  const missingBasis = Math.max(0, s.missingCapBasis);

  const drivers: HealthDriver[] = [
    {
      code: 'POOL_CONSERVATION_BREACH',
      label: 'Havuz korunum ihlali',
      impact: riskImpact(breaches, 0, CONSERVATION_PER_UNIT, CONSERVATION_CAP),
      value: breaches,
      threshold: 0,
    },
    {
      code: 'MISSING_CAP_BASIS',
      label: 'Eksik tavan tabanı',
      impact: riskImpact(missingBasis, 0, MISSING_BASIS_PER_UNIT, MISSING_BASIS_CAP),
      value: missingBasis,
      threshold: 0,
    },
  ];
  const score = roundScore(100 + drivers.reduce((a, d) => a + d.impact, 0));
  return {
    dimension: 'financial_integrity',
    score,
    confidence: sampleConfidence(s.allocationCount, MIN_ALLOCATIONS),
    drivers,
    evidence,
  };
}

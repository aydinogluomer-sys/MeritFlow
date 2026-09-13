// The pure health engine orchestrator (§3.3/§3.4). Maps frozen HealthSignals → a HealthEvaluation:
// six per-dimension { score, confidence, drivers[], evidence[] } sub-scores + a TRANSPARENT weighted
// overall (§26 — no opaque number). DETERMINISTIC + REPRODUCIBLE: same signals + HEALTH_RULE_SET_VERSION
// → identical output. No I/O, no LLM, no mutation. The repository produces the signals; this is pure.
import type { EvidenceRef } from '@/modules/intelligence';
import type { HealthEvaluation, HealthSignals } from './types';
import { scoreConcentration } from './rules/concentration.rules';
import { scoreDiscretion } from './rules/discretion.rules';
import { scoreGaming } from './rules/gaming.rules';
import { scoreDispute } from './rules/dispute.rules';
import { scoreFinancialIntegrity } from './rules/financial-integrity.rules';
import { scoreComplexity } from './rules/complexity.rules';
import { aggregateOverall, DEFERRED_DIMENSIONS, HEALTH_RULE_SET_VERSION } from './rules/weights.rules';

/** Build the per-dimension evidence lists from the gathered source ids (always ≥ the policy version). */
function buildEvidence(signals: HealthSignals): {
  version: EvidenceRef[];
  runs: EvidenceRef[];
  disputes: EvidenceRef[];
} {
  const version: EvidenceRef[] = [{ sourceType: 'policy_version', sourceId: signals.evidence.policyVersionId }];
  const runs: EvidenceRef[] = signals.evidence.calculationRunIds.map((id) => ({ sourceType: 'bonus_run', sourceId: id }));
  const disputes: EvidenceRef[] = signals.evidence.disputeIds.map((id) => ({ sourceType: 'dispute', sourceId: id }));
  return { version, runs, disputes };
}

/**
 * Evaluate incentive health from frozen signals. Pure + deterministic + reproducible. Every dimension
 * exposes transparent drivers + evidence; the overall is a documented weighted aggregate of the
 * sub-scores (weights returned) — never opaque (§26). All scores are integers in [0, 100]; no NaN.
 */
export function evaluateHealth(signals: HealthSignals): HealthEvaluation {
  const ev = buildEvidence(signals);
  const dimensions = [
    scoreFinancialIntegrity(signals.financialIntegrity, [...ev.version, ...ev.runs]),
    scoreConcentration(signals.concentration, [...ev.version, ...ev.runs]),
    scoreGaming(signals.gaming, ev.version),
    scoreDiscretion(signals.discretion, ev.version),
    scoreDispute(signals.dispute, [...ev.version, ...ev.disputes]),
    scoreComplexity(signals.complexity, ev.version),
  ];
  const { overallScore, weights } = aggregateOverall(dimensions);
  return {
    ruleSetVersion: HEALTH_RULE_SET_VERSION,
    overallScore,
    dimensions,
    weights,
    deferredDimensions: [...DEFERRED_DIMENSIONS],
  };
}

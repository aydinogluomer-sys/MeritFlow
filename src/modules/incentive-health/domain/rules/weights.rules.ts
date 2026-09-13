// Overall aggregation rule (§3.3/§26). The overall health is a DOCUMENTED, published weighted mean of
// the dimension sub-scores — NOT an opaque black-box number. The weights below are versioned as part
// of HEALTH_RULE_SET_VERSION; the evaluation persists them so the aggregate is fully auditable:
//   overall = round( Σ (weight_d · score_d) / Σ weight_d ).
// Confidence is reported PER dimension and deliberately NOT folded into the aggregate (that would
// hide low-data dimensions and make the overall harder to reproduce/explain).
import type { DimensionScore, HealthDimensionKey, HealthWeight } from '../types';
import { roundScore } from '../score-util';

// The health rule-set tag. Bumping ANY threshold/weight/rule anywhere in domain/rules/** REQUIRES
// bumping this so persisted evaluations (keyed by policy_version_id + rule_set_version) stay reproducible.
export const HEALTH_RULE_SET_VERSION = 'health-v1';

// Financial integrity is weighted highest (money correctness); dispute/complexity lowest.
export const DIMENSION_WEIGHTS: Record<HealthDimensionKey, number> = {
  financial_integrity: 3,
  payout_concentration: 2,
  gaming_resistance: 2,
  manager_discretion: 2,
  dispute_exposure: 1,
  complexity: 1,
};

// Dimensions from §3.2 intentionally NOT computed in 1-A, documented for transparency.
export const DEFERRED_DIMENSIONS = ['opportunity_balance', 'controllability'] as const;

/**
 * Transparent weighted aggregate of the sub-scores. Returns the overall AND the exact weights used
 * (persisted with the evaluation) so any consumer can re-derive the overall from the sub-scores.
 */
export function aggregateOverall(dimensions: DimensionScore[]): {
  overallScore: number;
  weights: HealthWeight[];
} {
  const weights: HealthWeight[] = [];
  let weightSum = 0;
  let acc = 0;
  for (const d of dimensions) {
    const weight = DIMENSION_WEIGHTS[d.dimension];
    weights.push({ dimension: d.dimension, weight });
    weightSum += weight;
    acc += weight * d.score;
  }
  const overallScore = weightSum > 0 ? roundScore(acc / weightSum) : 100;
  return { overallScore, weights };
}

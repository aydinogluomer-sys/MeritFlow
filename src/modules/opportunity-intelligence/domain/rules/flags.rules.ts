// Deterministic advisory flags (§4.6). Every flag means "Investigate" — NEVER a verdict, NEVER a pay
// decision (§4.2/§26). Thresholds are transparent + versioned (bump ⇒ bump OPPORTUNITY_RULE_SET_VERSION).
import type { OpportunityComponent, OpportunityComponentCode, OpportunityFlag } from '../types';

// A component sub-score at/below this (of 100) is a reviewable opportunity shortfall (≈ ratio < 0.68 of
// the cohort norm, since a score of 50 = at the cohort median).
export const FLAG_LOW_SCORE = 34;
// Complexity is about MIX BALANCE (§4.3): an IMBALANCE is a large deviation from the cohort norm in
// EITHER direction — under-exposed (missed growth work) OR over-exposed (disproportionate hard work).
// Symmetric around the 50 cohort-norm: flag when score ≤ FLAG_LOW_SCORE OR ≥ FLAG_HIGH_SCORE.
export const FLAG_HIGH_SCORE = 66;
// The opportunity index at/above this counts as "adequate opportunity" (for the mismatch flag).
export const OPPORTUNITY_ADEQUATE = 60;
// A cohort-relative completion sub-score at/below this = low OUTPUT (used only by the mismatch flag).
export const LOW_COMPLETION_SCORE = 34;

function scoreOf(components: OpportunityComponent[], code: OpportunityComponentCode): number {
  return components.find((c) => c.code === code)?.score ?? 100;
}

/**
 * Advisory flags. `completionScore` is the employee's cohort-relative completion-rate sub-score (per
 * active day) — used ONLY to separate low OUTPUT from low OPPORTUNITY (the module's whole purpose,
 * §4.1). Deterministic given the components + index + completionScore.
 */
export function deriveFlags(
  components: OpportunityComponent[],
  index: number,
  completionScore: number,
): OpportunityFlag[] {
  const flags: OpportunityFlag[] = [];
  if (scoreOf(components, 'assignment_share') <= FLAG_LOW_SCORE) flags.push('LOW_ASSIGNMENT_OPPORTUNITY');
  // Imbalance = a large deviation from the cohort complexity norm in EITHER direction (§4.3 mix balance).
  const complexity = scoreOf(components, 'complexity_exposure');
  if (complexity <= FLAG_LOW_SCORE || complexity >= FLAG_HIGH_SCORE) flags.push('HIGH_COMPLEXITY_IMBALANCE');
  if (scoreOf(components, 'review_throughput') <= FLAG_LOW_SCORE) flags.push('REVIEW_BOTTLENECK');
  if (scoreOf(components, 'work_availability') <= FLAG_LOW_SCORE) flags.push('LOW_ELIGIBLE_WORK_AVAILABILITY');
  // Opportunity was adequate yet output was low ⇒ investigate PERFORMANCE, not opportunity.
  if (index >= OPPORTUNITY_ADEQUATE && completionScore <= LOW_COMPLETION_SCORE) {
    flags.push('PERFORMANCE_OPPORTUNITY_MISMATCH');
  }
  return flags;
}

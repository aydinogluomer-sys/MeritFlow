// Policy debt total (Module 4-B, §6.6). PURE + DETERMINISTIC V1: debt = static complexity + runtime
// maintenance burden. Combines the 4-A static evaluation and the 4-B runtime evaluation into ONE
// transparent result (drivers concatenated). No opaque aggregate. Persisted as a NEW immutable row
// with FULL_RULE_SET_VERSION (4-A's static-only rows remain).
import type { DebtEvaluation, RuntimeComplexityResult, StaticComplexityResult } from './types';

// The full (static + runtime) rule-set tag. Bump when EITHER the static ('static-v1') or runtime
// ('runtime-v1') rules change, so a persisted debt evaluation stays reproducible.
export const FULL_RULE_SET_VERSION = 'full-v1';

/**
 * Compose a full debt evaluation from a static + runtime result. total_score = static + runtime;
 * components = static drivers followed by runtime drivers (every point traces to a driver).
 */
export function computeDebtEvaluation(
  staticResult: StaticComplexityResult,
  runtimeResult: RuntimeComplexityResult,
): DebtEvaluation {
  const totalScore = staticResult.staticScore + runtimeResult.runtimeScore;
  return {
    ruleSetVersion: FULL_RULE_SET_VERSION,
    staticScore: staticResult.staticScore,
    runtimeScore: runtimeResult.runtimeScore,
    totalScore,
    components: [...staticResult.components, ...runtimeResult.components],
  };
}

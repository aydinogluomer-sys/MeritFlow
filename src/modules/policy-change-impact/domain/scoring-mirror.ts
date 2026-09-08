// Pure scoring mirror (Module 6-B). Reproduces the DB scoring engine EXACTLY — migration 0020
// public.compute_final_points() / doc-04 §57-65:
//
//   final = base × m_complexity × m_impact × m_quality × m_timeliness × (1 − least(revisions × rate, cap))
//
// Raw numeric, NO rounding (0020 decision D; points_delta is the financial truth). collaboration_score
// is NOT a parameter (AD5). This is the ADVISORY re-scoring used by the backtest to answer "what would
// this historical task have scored under a DIFFERENT policy version?" — it never writes a ledger and
// never mutates a policy version. Float64 (same precision class as the allocateBonus reference engine);
// exact for the golden worked example; advisory precision for arbitrary multipliers.
import type { JsonObject } from './types';

/** The historical raw scoring inputs of one approved task (from point_ledger.metadata / tasks+reviews). */
export interface ScoringInputs {
  basePoints: number;
  complexity: string;
  impact: string;
  quality: string;
  timeliness: string;
  revisionCount: number;
}

/** The diffable scoring config of a scoring_policy_version (multipliers + revision penalty rule). */
export interface ScoringPolicy {
  multipliers: JsonObject; // { complexity:{level:mult}, impact:{...}, quality:{...}, timeliness:{...} }
  revisionPenaltyRule: JsonObject; // { rate_per_revision, cap }
}

const DEFAULT_RATE = 0.05; // 0020 coalesce defaults
const DEFAULT_CAP = 0.25;

/** Numeric multiplier at multipliers[dimension][level], or null when absent/non-numeric (DB → NULL). */
function multiplier(m: JsonObject, dimension: string, level: string): number | null {
  const dim = m[dimension];
  if (dim === null || typeof dim !== 'object' || Array.isArray(dim)) return null;
  const v = (dim as JsonObject)[level];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function ruleNumber(rule: JsonObject, key: string, fallback: number): number {
  const v = rule[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Score one task under a scoring policy. Returns the raw final points, or NULL when the policy does
 * not define a required multiplier level (mirrors the DB, where a missing level → NULL). Callers that
 * need every task scoreable (the backtest) treat a null as "this policy version is incomplete".
 */
export function scoreTask(inputs: ScoringInputs, policy: ScoringPolicy): number | null {
  const mc = multiplier(policy.multipliers, 'complexity', inputs.complexity);
  const mi = multiplier(policy.multipliers, 'impact', inputs.impact);
  const mq = multiplier(policy.multipliers, 'quality', inputs.quality);
  const mt = multiplier(policy.multipliers, 'timeliness', inputs.timeliness);
  if (mc === null || mi === null || mq === null || mt === null) return null;

  const rate = ruleNumber(policy.revisionPenaltyRule, 'rate_per_revision', DEFAULT_RATE);
  const cap = ruleNumber(policy.revisionPenaltyRule, 'cap', DEFAULT_CAP);
  const penalty = Math.min(inputs.revisionCount * rate, cap);

  return inputs.basePoints * mc * mi * mq * mt * (1 - penalty);
}

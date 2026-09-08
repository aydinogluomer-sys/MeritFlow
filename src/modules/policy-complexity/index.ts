// Public API for the `policy-complexity` domain module (Module 4 — Phase P1, plan §6).
// Slices 4-A + 4-B: the DETERMINISTIC, versioned STATIC + RUNTIME complexity engines, the debt total
// (static + runtime), the version trend, and the ADVISORY simplification candidates + insight
// emission — over the append-only evaluation store. Consumers import ONLY from
// `@/modules/policy-complexity` — never a deep internal path (ESLint no-restricted-imports boundary).
// The engines READ a scoring_policy_version config + operational data and NEVER mutate any policy
// (§26); every score decomposes into transparent drivers (no opaque aggregate); simplification is
// advisory only (never auto-applied); no LLM. The UI is slice 4-C (deferred).

// --- Static-complexity rule engine (pure, versioned, transparent) ---
export {
  evaluateStaticComplexity,
  configFromVersionRow,
  RULE_SET_VERSION,
  COMPLEXITY_RULES,
} from './domain/complexity-rules';
export type {
  JsonValue,
  JsonObject,
  ScoringPolicyConfig,
  ComplexityDriver,
  StaticComplexityResult,
} from './domain/types';

// --- Evaluation store repository (RLS reads / server-only writes) ---
export {
  PolicyComplexityRepository,
  type PolicyComplexityEvaluation,
} from './repository/policy-complexity-repository';

// --- Application (feature-flag gated evaluate-and-persist) ---
export { evaluatePolicyComplexity } from './application/evaluate-complexity';
export type { PolicyComplexityContext } from './application/feature-gate';

// --- 4-B: runtime complexity + debt total + trend + simplification (pure, versioned) ---
export { evaluateRuntimeComplexity, RUNTIME_RULE_SET_VERSION, RUNTIME_RULES } from './domain/runtime-rules';
export { computeDebtEvaluation, FULL_RULE_SET_VERSION } from './domain/debt';
export { computeVersionTrend, type TrendInput } from './domain/trend';
export { findSimplificationCandidates, type BucketUsage } from './domain/simplification';
export type {
  RuntimeSignals,
  RuntimeComplexityResult,
  DebtEvaluation,
  VersionTrendEntry,
  SimplificationCandidate,
} from './domain/types';
export type { PolicyVersionRef } from './repository/policy-complexity-repository';

// --- 4-B: application (feature-flag gated debt evaluation + advisory insight, version trend) ---
export { evaluatePolicyDebt, type PolicyDebtResult } from './application/evaluate-debt';
export { getPolicyComplexityTrend } from './application/version-trend';

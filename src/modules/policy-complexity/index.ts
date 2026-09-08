// Public API for the `policy-complexity` domain module (Module 4 — Phase P1, plan §6).
// Slice 4-A: the DETERMINISTIC, versioned STATIC-complexity engine + its append-only evaluation
// store. Consumers import ONLY from `@/modules/policy-complexity` — never a deep internal path
// (ESLint no-restricted-imports boundary). The engine READS a scoring_policy_version config and
// NEVER mutates any policy (§26); every score decomposes into transparent drivers (no opaque
// aggregate); no LLM. Runtime complexity / debt total / version trend / simplification candidates /
// UI are slice 4-B (deferred).

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

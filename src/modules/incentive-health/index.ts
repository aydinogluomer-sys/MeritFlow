// Incentive Health Engine (Module 1-A) — PUBLIC API. Consumers import ONLY from this barrel
// (@/modules/incentive-health), never a deep internal path (ENGINEERING-02A boundary). The engine is
// deterministic + versioned + reproducible; every dimension decomposes into transparent drivers +
// evidence and the overall is a documented weighted aggregate (§26 — no opaque score). No LLM.

// Domain — pure engine + versioned rule catalogs (thresholds/rationale) for transparency (§3.5).
export { evaluateHealth } from './domain/evaluate-health';
export type {
  HealthDriver,
  HealthDimensionKey,
  DimensionScore,
  HealthWeight,
  HealthEvaluation,
  HealthSignals,
  ConcentrationSignals,
  DiscretionSignals,
  GamingSignals,
  DisputeSignals,
  FinancialIntegritySignals,
  ComplexitySignals,
} from './domain/types';
export {
  HEALTH_RULE_SET_VERSION,
  DIMENSION_WEIGHTS,
  DEFERRED_DIMENSIONS,
  aggregateOverall,
} from './domain/rules/weights.rules';
export { CONCENTRATION_RULES } from './domain/rules/concentration.rules';
export { DISCRETION_RULES } from './domain/rules/discretion.rules';
export { GAMING_RULES } from './domain/rules/gaming.rules';
export { DISPUTE_RULES } from './domain/rules/dispute.rules';
export { FINANCIAL_INTEGRITY_RULES } from './domain/rules/financial-integrity.rules';
export { COMPLEXITY_RULES } from './domain/rules/complexity.rules';

// Repository (RLS reads / admin writes) + application (feature-flag gated evaluate-and-persist).
export {
  IncentiveHealthRepository,
  type PolicyHealthEvaluation,
  type PolicyHealthRiskAcceptance,
} from './repository/incentive-health-repository';
export { assertHealthEngineEnabled, type HealthContext } from './application/feature-gate';
export { evaluatePolicyHealth, type PolicyHealthResult } from './application/evaluate-and-persist';

// Module 1-B — comparison-to-previous health delta (deterministic) + risk-acceptance (waiver) workflow.
export {
  computeHealthComparison,
  pickPreviousVersion,
  type ComparableEvaluation,
  type HealthComparison,
  type DimensionDelta,
  type ScoreDelta,
} from './domain/compare-health';
export { getHealthComparison } from './application/health-comparison';
export {
  acceptHealthRisk,
  listHealthRiskAcceptances,
  type AcceptHealthRiskInput,
} from './application/risk-acceptance';

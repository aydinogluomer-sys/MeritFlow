// Opportunity-to-Perform Intelligence (Module 2-A) — PUBLIC API. Consumers import ONLY from this
// barrel (@/modules/opportunity-intelligence), never a deep internal path (ENGINEERING-02A boundary).
// The engine is deterministic + versioned + cohort-normalized; the index is a transparent decomposed
// aggregate (no opaque ML, §26); it reads ONLY work-context signals (no protected attribute, no
// compensation, §4.2); output is advisory (drives no pay/ledger). No LLM.

// Domain — pure cohort engine + versioned rule constants (for transparency, §4.3/§4.5).
export { computeOpportunity, OPPORTUNITY_RULE_SET_VERSION } from './domain/compute-opportunity';
export type {
  Complexity,
  MemberSignals,
  OpportunityDriver,
  OpportunityComponent,
  OpportunityComponentCode,
  OpportunityComponentWeight,
  OpportunityFlag,
  OpportunityResult,
} from './domain/types';
export {
  MIN_COHORT_SIZE,
  COMPLEXITY_WEIGHTS,
  COMPONENT_WEIGHTS,
  TARGET_POOL_PER_MEMBER,
  componentWeights,
} from './domain/rules/weights.rules';
export { deriveFlags, FLAG_LOW_SCORE, FLAG_HIGH_SCORE, OPPORTUNITY_ADEQUATE, LOW_COMPLETION_SCORE } from './domain/rules/flags.rules';

// Repository (RLS reads / admin writes) + application (feature-flag gated compute-and-persist).
export {
  OpportunityRepository,
  type OpportunitySnapshotRecord,
  type OpportunityComponentsPayload,
} from './repository/opportunity-repository';
export { assertOpportunityIntelligenceEnabled, type OpportunityContext } from './application/feature-gate';
export {
  computeOpportunitySnapshots,
  type OpportunityComputeResult,
} from './application/compute-and-persist';

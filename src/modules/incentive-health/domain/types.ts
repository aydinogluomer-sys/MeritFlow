// Incentive Health Engine (Module 1-A) — domain types. The engine is PURE + DETERMINISTIC +
// VERSIONED: it maps frozen HealthSignals (read from operational tables + the policy config +
// Module 4 static complexity) to a per-dimension { score, confidence, drivers[], evidence[] } and a
// TRANSPARENT weighted overall (§3.3/§3.4/§26 — never an opaque single number). Scores are 0–100,
// higher = healthier; each risk is a driver with a signed (negative) impact off a 100 baseline. No
// LLM, no NaN, no mutation of any policy/ledger (§26). Mirrors the Module 4 signal/engine split.
import type { EvidenceRef } from '@/modules/intelligence';

/** A transparent contribution to a dimension sub-score (§3.4). impact is signed points off the 100
 * baseline (risk ⇒ negative); value/threshold expose the measured input and the rule boundary. */
export interface HealthDriver {
  code: string;
  label: string;
  impact: number;
  value: number;
  threshold?: number;
}

/** The V1 computed health dimensions (§3.2). §3.3 renders Gaming as "resistance" (higher = safer),
 * so the key is gaming_resistance. Opportunity Balance + Controllability are DEFERRED (see weights). */
export type HealthDimensionKey =
  | 'financial_integrity'
  | 'payout_concentration'
  | 'gaming_resistance'
  | 'manager_discretion'
  | 'dispute_exposure'
  | 'complexity';

/** Per-dimension score contract (§3.4): a sub-score + confidence + transparent drivers + evidence. */
export interface DimensionScore {
  dimension: HealthDimensionKey;
  score: number; // 0..100, higher = healthier
  confidence: number; // 0..1, deterministic function of data availability
  drivers: HealthDriver[];
  evidence: EvidenceRef[];
}

/** The exact weight applied to a dimension in the overall aggregate (published → auditable). */
export interface HealthWeight {
  dimension: HealthDimensionKey;
  weight: number;
}

/** The reproducible health evaluation. overall_score is a DOCUMENTED weighted aggregate of the
 * sub-scores (weights below) — never opaque (§26). deferredDimensions documents what 1-A omits. */
export interface HealthEvaluation {
  ruleSetVersion: string;
  overallScore: number;
  dimensions: DimensionScore[];
  weights: HealthWeight[];
  deferredDimensions: string[];
}

// ── Frozen signals (repository-produced, engine-consumed) ─────────────────────────────────────────

/** Per-employee payout totals (minor units) for the version's completed runs — Payout Concentration. */
export interface ConcentrationSignals {
  payouts: number[];
}

/** Manager Discretion: manual-adjustment magnitude vs scored (task_approved) points for the version.
 * Only TASK-LINKED manual adjustments are version-attributable (task-less overrides carry no version
 * linkage — see the repository header); this measures the task-linked override share. */
export interface DiscretionSignals {
  scoredPoints: number; // Σ task_approved points_delta for the version (≥ 0)
  overrideMagnitude: number; // Σ |task-linked manual_adjustment points_delta| for the version (≥ 0)
  scoredCount: number; // # task_approved rows (confidence sample)
  overrideCount: number; // # task-linked manual_adjustment rows (confidence sample + context)
}

/** Gaming Resistance (config-derived): threshold cliffs from the policy multipliers (Module 4 cliff
 * logic). Operational anti-gaming signals (reviewer concentration, end-period spike) are DEFERRED. */
export interface GamingSignals {
  cliffCount: number;
}

/** Dispute Exposure: disputes deterministically attributable to the version via polymorphic targets. */
export interface DisputeSignals {
  attributableDisputes: number;
  openOrUnresolved: number;
  scopedTargets: number; // # target rows (allocations+runs+ledger) for the version (coverage denom)
}

/** Financial Integrity: pool conservation + missing cap basis (per completed run). Literal cap
 * overflow is DB-enforced (bonus_allocations_cap_not_exceeded_chk) so it is not a signal here. */
export interface FinancialIntegritySignals {
  pools: Array<{ declared: number; allocated: number; undistributed: number }>;
  missingCapBasis: number;
  allocationCount: number;
}

/** Complexity (§12.4): the version's Module 4 static-complexity score (config-derived; always known). */
export interface ComplexitySignals {
  staticScore: number;
}

/** Evidence source ids gathered while reading signals — the engine turns these into EvidenceRefs. */
export interface HealthEvidenceRefs {
  policyVersionId: string;
  calculationRunIds: string[];
  disputeIds: string[];
}

/** The complete frozen input to the pure engine. */
export interface HealthSignals {
  concentration: ConcentrationSignals;
  discretion: DiscretionSignals;
  gaming: GamingSignals;
  dispute: DisputeSignals;
  financialIntegrity: FinancialIntegritySignals;
  complexity: ComplexitySignals;
  evidence: HealthEvidenceRefs;
}

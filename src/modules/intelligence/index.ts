// Public API for the `intelligence` domain module (Phase P0 — Shared Foundation, plan §2).
// Consumers import ONLY from `@/modules/intelligence` — never a deep internal path (ESLint
// no-restricted-imports boundary). This barrel exposes the semantic metric SSOT (contracts +
// registry + validator), the evidence envelope + insight lifecycle, the insight-store repository,
// the feature-flag resolver, and the typed telemetry emitter. No LLM, no financial calculation:
// the deterministic contracts + insight facts are authoritative; model output is advisory.

// --- Semantic metric contract (SSOT) ---
export * from './metrics/metric-id';
export * from './metrics/metric-result';
export * from './metrics/semantic-query';
export * from './metrics/registry';
export * from './metrics/validator';

// --- Deterministic metric execution (P4 / Module 8-A1) ---
// The semantic query service + drill scaffolding + executor capability introspection. Individual
// executors stay internal; consumers reach the layer only through the service / drill / capability API.
export {
  executeSemanticQuery,
  type SemanticQueryContext,
  type SemanticQueryOutcome,
  type MetricQueryResult,
  type MetricComparison,
  type ExecuteOptions,
} from './application/semantic-query-service';
export {
  buildDrillQuery,
  availableDrillLevels,
  DRILL_LEVELS,
  type DrillLevel,
  type DrillRequest,
  type BuildDrillResult,
} from './application/drill-service';
export { isMetricExecutable, servableDimensions } from './metrics/executors/registry';
export { METRICS_RULESET_VERSION } from './metrics/executors/types';
export { type ExecutionError, type ExecutionErrorCode } from './metrics/executors/errors';

// --- Approved dimension catalog ---
export * from './dimensions/dimension-catalog';

// --- Evidence envelope + insight domain ---
export * from './domain/evidence';
export * from './domain/insight';
export * from './domain/insight-status';

// --- Insight store repository (RLS reads / server-only writes) ---
export * from './repository/intelligence-repository';

// --- Feature flags ---
export * from './feature-flags/keys';
export * from './feature-flags/resolver';

// --- Telemetry ---
export * from './telemetry/emit';

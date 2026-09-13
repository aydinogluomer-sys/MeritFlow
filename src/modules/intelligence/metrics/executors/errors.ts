// Phase P4 — Module 8-A1 · execution-layer error codes. These are DISTINCT from the P0 validator's
// ValidationError codes: validation answers "is this query well-formed + permitted?" while execution
// answers "can 8-A1 actually compute it?". Per coordinator decision 2, an un-serveable request is
// REJECTED with one of these — never served as a silent subset or a misleading 0.
export type ExecutionErrorCode =
  | 'feature_disabled' // the 'intelligence' feature flag is off for the org (fail-closed)
  | 'metric_not_executable' // no executor for the metric
  | 'metric_not_available_for_role' // executor exists but the caller's role cannot read its source (SI-12 — 8-A2)
  | 'dimension_not_executable' // registry-allowed but this executor cannot serve the dimension yet
  | 'filter_not_executable' // unsupported filter operator (serves eq/in on categorical dims only)
  | 'period_not_found' // the requested bonus_period / range resolved to no in-scope period
  | 'comparison_not_executable'; // comparison requested with a non-anchored (range/relative) period

export interface ExecutionError {
  code: ExecutionErrorCode;
  message: string;
}

export function executionError(code: ExecutionErrorCode, message: string): ExecutionError {
  return { code, message };
}

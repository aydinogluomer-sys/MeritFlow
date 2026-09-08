// Policy Complexity (Module 4-A) — shared domain types. Pure; no I/O. The engine READS a
// scoring_policy_version config and NEVER mutates it (§26 Policy Debt gate).

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * The analyzed config of a scoring_policy_version (0008): the bucket multiplier tables, the revision
 * penalty rule, and any custom timeliness thresholds. Inner keys are verbatim jsonb keys.
 */
export interface ScoringPolicyConfig {
  multipliers: JsonObject; // dimension → { bucket: multiplier }
  revisionPenaltyRule: JsonObject; // { rate_per_revision, cap }
  timelinessThresholds: JsonObject; // custom thresholds ({} in the standard seed)
}

/**
 * A transparent complexity driver (§6.3). Shape aligns with the P0 DriverList primitive so 4-B's UI
 * can render it directly. `impact` is the points this component contributes to static_score.
 */
export interface ComplexityDriver {
  code: string;
  label: string;
  impact: number;
  value: number;
  threshold?: number;
}

export interface StaticComplexityResult {
  ruleSetVersion: string;
  staticScore: number;
  components: ComplexityDriver[];
}

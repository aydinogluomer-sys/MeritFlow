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

// ── Module 4-B: runtime complexity, debt total, trend, simplification ────────────────────────

/**
 * Deterministic runtime signals for a policy version over its operational window (§6.5). Counts are
 * read from append-only / terminal operational data, so the window is frozen at evaluation time.
 * `taskApprovedCount` is CONTEXT only (scored-work volume) — it does not add to runtime_score.
 */
export interface RuntimeSignals {
  overrideCount: number; // manual_adjustment rows on the version's tasks (maintenance burden)
  recalculationCount: number; // superseded bonus_calculation_runs for the version
  taskApprovedCount: number; // scored-work volume (context; not scored)
  // NOTE (§6.5 deferred): dispute-adjustment usage is NOT included — dispute_adjustment rows do not
  // carry scoring_policy_version_id (0025) and disputes.target_id is polymorphic with no task FK
  // (0015), so a version cannot be cleanly attributed without a dispute→task→version resolver. A dead
  // "always 0" signal would mislead; it is deferred with disputes.count / anti_gaming_flags.
}

export interface RuntimeComplexityResult {
  ruleSetVersion: string;
  runtimeScore: number;
  components: ComplexityDriver[];
}

/** A full debt evaluation (§6.6): static + runtime, with the combined transparent drivers. */
export interface DebtEvaluation {
  ruleSetVersion: string;
  staticScore: number;
  runtimeScore: number;
  totalScore: number; // static + runtime (deterministic V1)
  components: ComplexityDriver[]; // static drivers ++ runtime drivers
}

/** One point on a policy's complexity/debt trend (§6.7), with the delta vs the previous version. */
export interface VersionTrendEntry {
  policyVersionId: string;
  versionNo: number;
  staticScore: number;
  runtimeScore: number | null;
  totalScore: number;
  deltaTotal: number; // totalScore − previous version's totalScore (0 for the first)
}

/**
 * A deterministic, ADVISORY simplification candidate (§6.8). NEVER auto-applied — it is surfaced for
 * human review only (§26). `kind` distinguishes a duplicate-outcome heuristic from an unused bucket.
 */
export interface SimplificationCandidate {
  code: string; // stable, greppable
  kind: 'duplicate_outcome' | 'unused_bucket';
  dimension: string;
  detail: string; // human-readable finding (TR)
  buckets: string[]; // the bucket keys involved
}

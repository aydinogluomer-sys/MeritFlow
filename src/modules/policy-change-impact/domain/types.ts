// Policy Change Impact — shared domain types (Module 6, slice 6-A). Pure; no I/O.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * The DIFFABLE content of a scoring_policy_version (plan §8.3). ONLY these three sections are
 * compared; version identity / status / notes / timestamps are metadata and are ignored (§8.11).
 * Inner keys are the verbatim jsonb keys (e.g. multipliers.complexity.high, revision_penalty_rule.cap).
 */
export interface PolicyVersionConfig {
  multipliers: JsonObject;
  revisionPenaltyRule: JsonObject;
  timelinessThresholds: JsonObject;
}

// §8.3 diff categories. eligibility/rounding are part of the taxonomy but do not occur in a
// scoring_policy_version config (they belong to allocation/bonus policy — future slices).
export type PolicyDiffCategory =
  | 'metric'
  | 'weight'
  | 'threshold'
  | 'cap'
  | 'eligibility'
  | 'formula'
  | 'rounding';

export type PolicyDiffChangeType = 'added' | 'removed' | 'changed';

export interface PolicyDiffEntry {
  path: string; // canonical dotted path, e.g. "multipliers.complexity.high"
  category: PolicyDiffCategory;
  changeType: PolicyDiffChangeType;
  before: JsonValue | null; // null when added
  after: JsonValue | null; // null when removed
}

export interface PolicyDiff {
  entries: PolicyDiffEntry[]; // deterministically ordered (by path)
  hasChanges: boolean;
}

// Change-request lifecycle (mirrors the DB state machine in migration 0043).
export const CHANGE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'changes_requested',
] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

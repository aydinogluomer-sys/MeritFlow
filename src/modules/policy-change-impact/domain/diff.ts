// Structural diff engine for scoring_policy_versions (Module 6 / slice 6-A, plan §8.3 & §8.11).
// PURE + DETERMINISTIC: no I/O, no randomness, no clock. Guarantees:
//   * order-independent — object key order never affects the result (compared by key set);
//   * metadata-ignoring — only the three config sections are compared (see configFromVersionRow);
//   * exact-same config -> empty diff; a changed threshold/weight -> a single categorized entry;
//   * output entries are sorted by path so the same inputs always yield byte-identical output.
import type {
  JsonObject,
  JsonValue,
  PolicyDiff,
  PolicyDiffCategory,
  PolicyDiffChangeType,
  PolicyDiffEntry,
  PolicyVersionConfig,
} from './types';

function isPlainObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Order-independent deep equality: objects compared by key set (not position), arrays by order. */
function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i] as JsonValue));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => k in b && deepEqual(a[k] as JsonValue, b[k] as JsonValue));
  }
  return false;
}

/**
 * Map a leaf path + change type to a §8.3 category. Deterministic and total. A multipliers VALUE
 * change is a weight change; a structural add/remove of a multiplier dimension/level is a metric
 * change; revision_penalty_rule.cap is a cap, its other fields are formula; thresholds are thresholds.
 */
function categorize(path: string, changeType: PolicyDiffChangeType): PolicyDiffCategory {
  const root = path.split('.')[0];
  if (root === 'revisionPenaltyRule') return path.endsWith('.cap') ? 'cap' : 'formula';
  if (root === 'timelinessThresholds') return 'threshold';
  if (root === 'multipliers') return changeType === 'changed' ? 'weight' : 'metric';
  return 'formula';
}

/** Emit leaf-level added/removed entries for a (possibly nested) subtree, deterministically. */
function emitSide(
  path: string,
  value: JsonValue,
  changeType: 'added' | 'removed',
  out: PolicyDiffEntry[],
): void {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const k of Object.keys(value).sort()) emitSide(`${path}.${k}`, value[k] as JsonValue, changeType, out);
    return;
  }
  out.push({
    path,
    category: categorize(path, changeType),
    changeType,
    before: changeType === 'removed' ? value : null,
    after: changeType === 'added' ? value : null,
  });
}

/** Recursively diff two values under `path`, accumulating leaf-level entries into `out`. */
function walk(before: JsonValue, after: JsonValue, path: string, out: PolicyDiffEntry[]): void {
  if (deepEqual(before, after)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    for (const k of keys) {
      const childPath = path ? `${path}.${k}` : k;
      const inBefore = k in before;
      const inAfter = k in after;
      if (inBefore && !inAfter) emitSide(childPath, before[k] as JsonValue, 'removed', out);
      else if (!inBefore && inAfter) emitSide(childPath, after[k] as JsonValue, 'added', out);
      else walk(before[k] as JsonValue, after[k] as JsonValue, childPath, out);
    }
    return;
  }

  // Leaf, type mismatch, or array -> a single 'changed' entry.
  out.push({ path, category: categorize(path, 'changed'), changeType: 'changed', before, after });
}

/**
 * Diff two scoring_policy_version configs. Reordering object fields yields NO diff; only genuine
 * value/structure changes to multipliers / revision_penalty_rule / timeliness_thresholds are reported.
 */
export function diffPolicyVersions(from: PolicyVersionConfig, to: PolicyVersionConfig): PolicyDiff {
  const out: PolicyDiffEntry[] = [];
  walk(from.multipliers, to.multipliers, 'multipliers', out);
  walk(from.revisionPenaltyRule, to.revisionPenaltyRule, 'revisionPenaltyRule', out);
  walk(from.timelinessThresholds, to.timelinessThresholds, 'timelinessThresholds', out);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries: out, hasChanges: out.length > 0 };
}

function asObject(v: unknown): JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
}

/**
 * Extract the diffable config from a raw scoring_policy_versions row, IGNORING all metadata
 * (id / version_no / status / notes / timestamps / created_by …). Accepts the DB snake_case jsonb
 * columns. This is what guarantees "hidden/irrelevant metadata is ignored" (§8.11).
 */
export function configFromVersionRow(row: Record<string, unknown>): PolicyVersionConfig {
  return {
    multipliers: asObject(row.multipliers),
    revisionPenaltyRule: asObject(row.revision_penalty_rule),
    timelinessThresholds: asObject(row.timeliness_thresholds),
  };
}

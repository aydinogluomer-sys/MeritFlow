// Simplification candidates (Module 4-B, §6.8). PURE + DETERMINISTIC heuristics → ADVISORY findings.
// NEVER auto-applied: these are surfaced for human review only (§26 — no auto-delete/auto-edit).
//   * duplicate_outcome: two+ buckets in a dimension share an identical multiplier (mergeable).
//   * unused_bucket: a config bucket that a version's scored work never exercised.
import type { JsonObject, JsonValue, ScoringPolicyConfig, SimplificationCandidate } from './types';

/** Which bucket keys were actually used per dimension (from the version's scored work). */
export type BucketUsage = Record<string, string[]>;

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function numeric(v: JsonValue | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Deterministically detect duplicate-outcome buckets within each dimension. */
function duplicateOutcome(config: ScoringPolicyConfig): SimplificationCandidate[] {
  const out: SimplificationCandidate[] = [];
  for (const dimension of Object.keys(config.multipliers).sort()) {
    const table = config.multipliers[dimension];
    if (!isObject(table)) continue;
    const byValue = new Map<number, string[]>();
    for (const bucket of Object.keys(table).sort()) {
      const n = numeric(table[bucket]);
      if (n === null) continue;
      const group = byValue.get(n) ?? [];
      group.push(bucket);
      byValue.set(n, group);
    }
    for (const [value, buckets] of Array.from(byValue.entries()).sort((a, b) => a[0] - b[0])) {
      if (buckets.length >= 2) {
        out.push({
          code: `duplicate_outcome:${dimension}:${buckets.join('+')}`,
          kind: 'duplicate_outcome',
          dimension,
          detail: `${dimension} boyutunda ${buckets.join(', ')} kovaları aynı çarpanı (${value}) üretiyor; birleştirilebilir.`,
          buckets,
        });
      }
    }
  }
  return out;
}

/** Deterministically detect config buckets never used by the version's scored work. */
function unusedBuckets(config: ScoringPolicyConfig, usage: BucketUsage): SimplificationCandidate[] {
  const out: SimplificationCandidate[] = [];
  for (const dimension of Object.keys(config.multipliers).sort()) {
    const table = config.multipliers[dimension];
    if (!isObject(table)) continue;
    const used = usage[dimension];
    // Only claim "unused" when there IS usage data for the dimension (avoid false positives when no
    // work has been scored under this version at all).
    if (!used || used.length === 0) continue;
    const usedSet = new Set(used);
    for (const bucket of Object.keys(table).sort()) {
      if (!usedSet.has(bucket)) {
        out.push({
          code: `unused_bucket:${dimension}:${bucket}`,
          kind: 'unused_bucket',
          dimension,
          detail: `${dimension} boyutundaki ${bucket} kovası son puanlanan işlerde hiç kullanılmadı.`,
          buckets: [bucket],
        });
      }
    }
  }
  return out;
}

/**
 * Compute the advisory simplification candidates for a policy version. Deterministic + reproducible;
 * duplicate-outcome from config alone, unused-bucket from config + observed usage. Ordered stably.
 */
export function findSimplificationCandidates(
  config: ScoringPolicyConfig,
  usage: BucketUsage,
): SimplificationCandidate[] {
  return [...duplicateOutcome(config), ...unusedBuckets(config, usage)].sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );
}

// Comparison-to-previous-policy health delta (Module 1-B, §3.11). PURE + DETERMINISTIC: given a
// version's health evaluation and the previous version's, compute the overall + per-dimension deltas
// (higher score = healthier, so a POSITIVE delta = improvement). Reads nothing, mutates nothing — the
// application layer supplies the two evaluations from policy_health_evaluations. Mirrors the Module 4
// version-trend pattern. No NaN; a missing previous (first version) yields null deltas.
import type { HealthDimensionKey } from './types';

/** The minimal evaluation shape the comparison needs (mapped from a persisted PolicyHealthEvaluation). */
export interface ComparableEvaluation {
  versionNo: number;
  overallScore: number;
  dimensions: Array<{ dimension: HealthDimensionKey; score: number }>;
}

export interface ScoreDelta {
  current: number | null;
  previous: number | null;
  delta: number | null; // current − previous; null when either side is absent
}

export interface DimensionDelta extends ScoreDelta {
  dimension: HealthDimensionKey;
}

export interface HealthComparison {
  currentVersionNo: number;
  previousVersionNo: number | null;
  hasPrevious: boolean;
  overall: ScoreDelta;
  dimensions: DimensionDelta[];
}

function delta(current: number | null, previous: number | null): number | null {
  return current !== null && previous !== null ? current - previous : null;
}

/**
 * Pure previous-version selection: the version with the largest version_no STRICTLY below
 * `currentVersionNo` (handles gaps in version numbers), or null when none exists (first version).
 * Deterministic; does not mutate the input.
 */
export function pickPreviousVersion<T extends { versionNo: number }>(
  versions: readonly T[],
  currentVersionNo: number,
): T | null {
  return versions
    .filter((v) => v.versionNo < currentVersionNo)
    .reduce<T | null>((best, v) => (best === null || v.versionNo > best.versionNo ? v : best), null);
}

/**
 * Compare a version's health evaluation to the previous version's. Deterministic: the same pair of
 * evaluations always yields the same deltas. `previous = null` (the version has no earlier version, or
 * the earlier version has no evaluation) ⇒ hasPrevious=false and every delta is null.
 */
export function computeHealthComparison(
  current: ComparableEvaluation,
  previous: ComparableEvaluation | null,
): HealthComparison {
  const prevByDimension = new Map<HealthDimensionKey, number>();
  if (previous) for (const d of previous.dimensions) prevByDimension.set(d.dimension, d.score);

  const dimensions: DimensionDelta[] = current.dimensions.map((d) => {
    const previousScore = previous && prevByDimension.has(d.dimension) ? prevByDimension.get(d.dimension)! : null;
    return { dimension: d.dimension, current: d.score, previous: previousScore, delta: delta(d.score, previousScore) };
  });

  return {
    currentVersionNo: current.versionNo,
    previousVersionNo: previous ? previous.versionNo : null,
    hasPrevious: previous !== null,
    overall: {
      current: current.overallScore,
      previous: previous ? previous.overallScore : null,
      delta: delta(current.overallScore, previous ? previous.overallScore : null),
    },
    dimensions,
  };
}

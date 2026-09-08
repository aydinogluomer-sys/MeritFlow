// Version complexity/debt trend (Module 4-B, §6.7). PURE + DETERMINISTIC read across a policy's
// versions (v4 → v5 → v6 → v7 …) with per-version deltas ("+12 since the previous version"). No
// opaque aggregate; no mutation.
import type { VersionTrendEntry } from './types';

/** One evaluated version fed into the trend (already joined: version metadata + its debt scores). */
export interface TrendInput {
  policyVersionId: string;
  versionNo: number;
  staticScore: number;
  runtimeScore: number | null;
  totalScore: number;
}

/**
 * Build the version trend: sort by version_no ascending and attach deltaTotal = total − previous
 * total (0 for the earliest). Deterministic given the same evaluated versions.
 */
export function computeVersionTrend(inputs: TrendInput[]): VersionTrendEntry[] {
  const sorted = [...inputs].sort((a, b) => a.versionNo - b.versionNo);
  let prevTotal: number | null = null;
  return sorted.map((v) => {
    const deltaTotal = prevTotal === null ? 0 : v.totalScore - prevTotal;
    prevTotal = v.totalScore;
    return {
      policyVersionId: v.policyVersionId,
      versionNo: v.versionNo,
      staticScore: v.staticScore,
      runtimeScore: v.runtimeScore,
      totalScore: v.totalScore,
      deltaTotal,
    };
  });
}

// Shared deterministic scoring helpers for the health engine. All pure; guarantee finite, clamped
// outputs (no NaN) and MONOTONIC risk (a larger measured value never raises a sub-score).

/** Clamp to the health range [0, 100]; a non-finite input collapses to 0 (never NaN escapes). */
export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Clamp then round to an integer 0–100 (dimension + overall scores are whole numbers). */
export function roundScore(n: number): number {
  return Math.round(clampScore(n));
}

/**
 * Deterministic risk impact off the 100 baseline: 0 when value ≤ threshold, else a NEGATIVE impact
 * that grows linearly with the excess-over-threshold (perUnit) and is capped at `cap`. Monotonic in
 * value ⇒ more risk never improves a score. Non-finite inputs collapse to 0 (no NaN).
 */
export function riskImpact(value: number, threshold: number, perUnit: number, cap: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(threshold)) return 0;
  const excess = Math.max(0, value - threshold);
  const magnitude = Math.min(Math.max(0, cap), perUnit * excess);
  // Round to 2 decimals so stored driver impacts are clean (no float noise like 11.9999…) and stable.
  return -(Math.round(magnitude * 100) / 100);
}

/**
 * Deterministic confidence in [0, 1] from a sample size: 0 at n = 0, ramping linearly to 1 at
 * n ≥ full. `full` ≤ 0 ⇒ the signal is always fully available (confidence 1).
 */
export function sampleConfidence(n: number, full: number): number {
  if (full <= 0) return 1;
  const c = n / full;
  return Math.max(0, Math.min(1, c));
}

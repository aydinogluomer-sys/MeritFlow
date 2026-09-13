// Shared deterministic helpers for the opportunity engine. All pure; guarantee finite, clamped
// outputs (no NaN) — a non-finite or divide-by-zero input collapses to a defined value.

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function roundScore(n: number): number {
  return Math.round(clampScore(n));
}

/** Median of a numeric list (0 for an empty list). Deterministic (sorts a copy). */
export function median(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  return n % 2 ? xs[(n - 1) / 2]! : (xs[n / 2 - 1]! + xs[n / 2]!) / 2;
}

/** Per-active-day rate; 0 active days ⇒ 0 (caller suppresses no-active-window members separately). */
export function perDay(total: number, activeDays: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(activeDays) || activeDays <= 0) return 0;
  return total / activeDays;
}

/** ratio = value / reference; 0 when the reference is 0 (no cohort signal ⇒ neutral handled by caller). */
export function ratio(value: number, reference: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0) return 0;
  return value / reference;
}

/**
 * "More is better" cohort score: 50 at the cohort reference (ratio 1), 100 at ≥ 2× the reference, 0 at
 * ratio 0. Monotonic increasing in value. Deterministic; never NaN.
 */
export function moreIsBetterScore(value: number, reference: number): number {
  if (reference <= 0) return 50; // no cohort signal to compare against ⇒ neutral
  return clampScore(50 * ratio(value, reference));
}

/**
 * "Less is better" cohort score (e.g. review latency): 50 at the reference, 100 at ≤ ½ the reference,
 * →0 as value grows. Monotonic decreasing in value. Deterministic; never NaN.
 */
export function lessIsBetterScore(value: number, reference: number): number {
  if (reference <= 0) return 50; // no cohort signal ⇒ neutral
  if (value <= 0) return 100; // no latency at all ⇒ maximal (no bottleneck)
  return clampScore(50 * (reference / value));
}

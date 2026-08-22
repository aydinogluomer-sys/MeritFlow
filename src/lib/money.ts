// ENGINEERING-25 — money / numeric precision policy.
//
// All monetary values in MeritFlow are MINOR UNIT INTEGERS (kuruş / cent). No floats in the ledger,
// allocation, or pool amounts. Factors (capRate, prorataFactor, tOrg) are purposely float (they are
// multipliers, not money); Math.floor brings the product back to an integer. DB money columns are
// numeric(15,0) — comfortably inside the JS safe-integer range.
//
// JS Number is exact for integers up to Number.MAX_SAFE_INTEGER (2^53 − 1 = 9 007 199 254 740 991).
// Above that, integer identity breaks (n and n+1 can compare equal). 2^53 minor units ≈ 90 trillion
// TRY — no realistic bonus pool approaches this, so the safe-integer ceiling is the guard rail.

/** Minor-unit integer (kuruş / cent). Always a safe integer ≥ 0 in ledger context. */
export type MinorAmount = number;

/** Throw if `value` is not a safe, non-negative integer — use at system entry points. */
export function assertMinorAmount(value: number, label = 'amount'): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite, got ${value}`);
  if (!Number.isInteger(value))
    throw new RangeError(`${label} must be an integer (no floats), got ${value}`);
  if (value < 0) throw new RangeError(`${label} must be ≥ 0, got ${value}`);
  if (!Number.isSafeInteger(value))
    throw new RangeError(
      `${label} exceeds MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}), got ${value}`,
    );
}

/**
 * Safe coercion from a DB value (numeric columns can arrive as string in PostgREST responses).
 * Throws if the result is not a safe, non-negative integer. Use for ledger/allocation amounts,
 * which the DB constrains to be ≥ 0 — NOT for reconciliation DIFFERENCES, which may be negative.
 */
export function toMinorAmount(raw: number | string, label = 'amount'): MinorAmount {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  assertMinorAmount(n, label);
  return n;
}

/**
 * Addition with an overflow guard. Throws if the sum exceeds MAX_SAFE_INTEGER. Use when accumulating
 * minor amounts where the running total is itself money (never for signed reconciliation deltas).
 */
export function safeAddMinor(a: MinorAmount, b: MinorAmount): MinorAmount {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new RangeError(`safeAddMinor overflow: ${a} + ${b} = ${result}`);
  return result;
}

// Bonus-calculation domain types (ENGINEERING-02D). The Safe Pro-Rata + largest-remainder
// calculation and idempotency live in the DB engine (0021) — this module only orchestrates the
// RPC calls (run_bonus_calculation / recalculate_bonus_after_dispute); it NEVER computes bonuses.

export interface RunCalculationInput {
  periodId: string;
  poolId: string;
  idempotencyKey: string;
}

export interface RecalculateInput {
  periodId: string;
}

export interface BonusCalculationContext {
  organizationId: string;
  userId: string;
}

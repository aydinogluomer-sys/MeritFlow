import type { BonusCalculationRepository } from '../repository/bonus-calculation-repository';
import type { BonusCalculationContext, RecalculateInput } from '../domain/types';

/**
 * Recalculate a bonus period after a dispute adjustment via the DB engine (0026). Repository is
 * INJECTED by the server action. Returns the RPC result as-is (pass-through).
 */
export async function recalculate(
  input: RecalculateInput,
  ctx: BonusCalculationContext,
  repo: BonusCalculationRepository,
): Promise<unknown> {
  return repo.recalculate(input, ctx);
}

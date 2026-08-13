import type { BonusCalculationRepository } from '../repository/bonus-calculation-repository';
import type { BonusCalculationContext, RunCalculationInput } from '../domain/types';

/**
 * Run a bonus calculation for a period/pool via the DB engine (0021). The admin-client-backed
 * repository is INJECTED by the server action. Returns the produced snapshot id.
 */
export async function runCalculation(
  input: RunCalculationInput,
  ctx: BonusCalculationContext,
  repo: BonusCalculationRepository,
): Promise<{ snapshotId: string }> {
  const snapshotId = await repo.runCalculation(input, ctx);
  return { snapshotId };
}

import type { PointLedgerRepository } from '../repository/point-ledger-repository';
import type { ManualOverrideInput, PointLedgerContext } from '../domain/types';

/**
 * Orchestrate a manual point adjustment. The admin-client-backed repository is INJECTED by the
 * server action (which owns admin-client creation), so this module stays admin-import-free.
 */
export async function manualOverride(
  input: ManualOverrideInput,
  ctx: PointLedgerContext,
  repo: PointLedgerRepository,
): Promise<{ ledgerId: string }> {
  const ledgerId = await repo.applyManualAdjustment(input, ctx);
  return { ledgerId };
}

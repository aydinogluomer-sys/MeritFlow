import type { ExportsRepository } from '../repository/exports-repository';
import type { ExportPayoutInput, ExportsContext } from '../domain/types';

/**
 * Produce a payout export from an immutable bonus snapshot. The admin-backed repo is injected by
 * the action (admin client is never value-imported into module files).
 */
export async function exportPayout(
  input: ExportPayoutInput,
  ctx: ExportsContext,
  repo: ExportsRepository,
): Promise<{ exportId: string }> {
  const exportId = await repo.produceExport(input, ctx);
  return { exportId };
}

import type { ExportsRepository } from '../repository/exports-repository';
import type { ExportsContext, MarkPaidInput } from '../domain/types';

/**
 * Mark a payout export as paid. Returns the raw RPC result unchanged (the action wraps it into
 * { ok: true, data }). Injected admin-backed repo.
 */
export async function markPaid(
  input: MarkPaidInput,
  ctx: ExportsContext,
  repo: ExportsRepository,
): Promise<unknown> {
  return repo.markPaid(input, ctx);
}

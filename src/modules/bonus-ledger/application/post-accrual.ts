import type { BonusLedgerRepository } from '../repository/bonus-ledger-repository';
import type { BonusLedgerContext, PostAccrualInput } from '../domain/types';

/**
 * Post the bonus accrual (double-entry ledger) from an approved snapshot via the DB (0022).
 * Repository is INJECTED by the server action. Returns the RPC result as-is (pass-through).
 */
export async function postAccrual(
  input: PostAccrualInput,
  ctx: BonusLedgerContext,
  repo: BonusLedgerRepository,
): Promise<unknown> {
  return repo.postAccrual(input, ctx);
}

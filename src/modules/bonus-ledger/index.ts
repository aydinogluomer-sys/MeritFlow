// Public API for the `bonus-ledger` domain module (ENGINEERING-02A boundary / 02D fill).
// Consumers import only from `@/modules/bonus-ledger` — never deep internal paths.
export { postAccrual } from './application/post-accrual';
export { BonusLedgerRepository } from './repository/bonus-ledger-repository';
export type { PostAccrualInput, BonusLedgerContext } from './domain/types';

// Bonus-ledger domain types (ENGINEERING-02D). The double-entry accrual (Σdebit=Σcredit) and
// snapshot immutability live in the DB (0014/0022) — this module only orchestrates the
// post_bonus_accrual RPC; it never posts ledger entries itself.

export interface PostAccrualInput {
  periodId: string;
}

export interface BonusLedgerContext {
  organizationId: string;
  userId: string;
}

export type InvariantId =
  | 'INV-SI13-POOL-SUM' // Σ(final_amount_minor) + undistributed ≠ pool_ref_minor
  | 'INV-LEDGER-BALANCE' // Σdebit ≠ Σcredit per (org, transaction_id)
  | 'INV-MISSING-SNAPSHOT' // completed run has no snapshot row
  | 'INV-DUPLICATE-ACCRUAL' // same snapshot accrued under >1 transaction_ids
  | 'INV-BL2-OVERACCRUAL'; // Σaccrual credits > pool_ref per snapshot

export type FindingSeverity = 'critical' | 'warning';

export interface ReconciliationFinding {
  invariant: InvariantId;
  severity: FindingSeverity;
  details: Record<string, unknown>; // run_id, transaction_id, etc. — no comp values
}

export interface ReconciliationReport {
  organizationId: string;
  ranAt: string; // ISO-8601
  findingCount: number;
  findings: ReconciliationFinding[];
}

export interface ReconciliationContext {
  organizationId: string;
  userId: string;
}

export const INVARIANT_SEVERITY: Record<InvariantId, FindingSeverity> = {
  'INV-SI13-POOL-SUM': 'critical',
  'INV-LEDGER-BALANCE': 'critical',
  'INV-MISSING-SNAPSHOT': 'warning',
  'INV-DUPLICATE-ACCRUAL': 'critical',
  'INV-BL2-OVERACCRUAL': 'critical',
};

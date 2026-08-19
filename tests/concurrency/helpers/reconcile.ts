import { Client } from 'pg';

// ENGINEERING-16 — post-race financial reconciliation via raw pg (the reconciliation MODULE uses
// server-only Next.js imports, so we run the two critical invariants directly here). These MIRROR
// src/modules/reconciliation/repository/reconciliation-repository.ts exactly, including the crucial
// rule that a run whose snapshot has NO `pool_ref_minor` in calculation_metadata is NOT an SI-13
// subject and is SKIPPED (poolRefOf → NaN → continue). The hand-built seed snapshots carry no
// pool_ref_minor, so pure-seed reconciliation is clean; only real engine runs are checked.

export interface ReconcileResult {
  criticalFindings: string[]; // invariant IDs that fired
}

// INV-SI13-POOL-SUM: Σ(final_amount_minor) + undistributed_remainder_minor = pool_ref_minor, per
//                    completed run — but ONLY for runs whose snapshot has a pool_ref_minor basis.
// INV-LEDGER-BALANCE: Σdebit = Σcredit per (org, transaction_id) in bonus_ledger.
export async function reconcile(client: Client, organizationId: string): Promise<ReconcileResult> {
  const criticalFindings: string[] = [];

  // INV-SI13-POOL-SUM — the NULLIF guard reproduces the module's "no pool_ref basis → skip" rule.
  const poolCheck = await client.query<{ run_id: string }>(
    `SELECT r.id AS run_id
       FROM public.bonus_calculation_runs r
       JOIN public.bonus_allocation_snapshots s ON s.calculation_run_id = r.id
       LEFT JOIN (
         SELECT calculation_run_id,
                SUM(final_amount_minor::numeric) AS sum_final
           FROM public.bonus_allocations
          GROUP BY calculation_run_id
       ) a ON a.calculation_run_id = r.id
      WHERE r.organization_id = $1
        AND r.status = 'completed'
        AND NULLIF(s.calculation_metadata->>'pool_ref_minor', '') IS NOT NULL
        AND (
          COALESCE(a.sum_final, 0)
          + COALESCE(s.undistributed_remainder_minor::numeric, 0)
        ) <> (s.calculation_metadata->>'pool_ref_minor')::numeric`,
    [organizationId],
  );
  if (poolCheck.rowCount && poolCheck.rowCount > 0) {
    criticalFindings.push('INV-SI13-POOL-SUM');
  }

  // INV-LEDGER-BALANCE
  const ledgerCheck = await client.query<{ transaction_id: string }>(
    `SELECT transaction_id
       FROM public.bonus_ledger
      WHERE organization_id = $1
      GROUP BY transaction_id
     HAVING SUM(CASE WHEN entry_type='debit'  THEN amount_minor::numeric ELSE 0 END)
         <> SUM(CASE WHEN entry_type='credit' THEN amount_minor::numeric ELSE 0 END)`,
    [organizationId],
  );
  if (ledgerCheck.rowCount && ledgerCheck.rowCount > 0) {
    criticalFindings.push('INV-LEDGER-BALANCE');
  }

  return { criticalFindings };
}

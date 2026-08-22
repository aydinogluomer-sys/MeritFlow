import { toDomainError } from '@/lib/errors';
import { toMinorAmount } from '@/lib/money';
import { poolRefFromMetadata } from '@/lib/db-schemas/bonus-snapshot-metadata';
import { INVARIANT_SEVERITY, type ReconciliationContext, type ReconciliationFinding } from '../domain/types';

type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;

// Column names verified against migrations 0013 (runs/allocations/snapshots) + 0014 (bonus_ledger)
// + 0021 engine (calculation_metadata.pool_ref_minor; SI-13: Σfinal + undistributed = pool_ref).
interface RunRow {
  id: string;
  bonus_period_id: string;
  status: string;
}
interface SnapshotRow {
  id: string;
  calculation_run_id: string;
  undistributed_remainder_minor: number | string;
  calculation_metadata: { pool_ref_minor?: number | string } | null;
}
interface AllocRow {
  calculation_run_id: string;
  final_amount_minor: number | string;
}
interface LedgerRow {
  snapshot_id: string | null;
  transaction_id: string;
  entry_type: string;
  account: string;
  amount_minor: number | string;
}

/**
 * pool_ref_minor from a snapshot's calculation_metadata, or NaN when absent/indeterminable.
 * Delegates to the Zod-validated {@link poolRefFromMetadata} (ENGINEERING-23) — the raw jsonb is
 * safeParse'd, so a malformed payload yields NaN (indeterminate), never a throw.
 */
function poolRefOf(snap: SnapshotRow): number {
  return poolRefFromMetadata(snap.calculation_metadata);
}

/**
 * READ-ONLY financial reconciliation queries (ENGINEERING-05). NEVER mutates a row or calls an
 * RPC. Uses the injected admin client because bonus_ledger / bonus_allocations /
 * bonus_calculation_runs / bonus_allocation_snapshots are RLS-restricted (Finance/Auditor only).
 * PostgREST aggregate support is limited, so each check fetches the org-scoped rows and aggregates
 * in TypeScript (acceptable at MVP scale; performance profiling lands in ENGINEERING-10).
 */
export class ReconciliationRepository {
  constructor(private readonly admin: AdminClient) {}

  private async completedRuns(org: string): Promise<RunRow[]> {
    const { data, error } = await this.admin
      .from('bonus_calculation_runs')
      .select('id, bonus_period_id, status')
      .eq('organization_id', org)
      .eq('status', 'completed');
    if (error) throw toDomainError(error);
    return (data ?? []) as RunRow[];
  }

  // INV-SI13: Σ(final_amount_minor) + undistributed_remainder_minor = pool_ref_minor, per run.
  async checkPoolSum(ctx: ReconciliationContext): Promise<ReconciliationFinding[]> {
    const org = ctx.organizationId;
    const runs = await this.completedRuns(org);
    if (runs.length === 0) return [];

    const snapsRes = await this.admin
      .from('bonus_allocation_snapshots')
      .select('id, calculation_run_id, undistributed_remainder_minor, calculation_metadata')
      .eq('organization_id', org);
    if (snapsRes.error) throw toDomainError(snapsRes.error);
    const snapshots = (snapsRes.data ?? []) as SnapshotRow[];

    const allocRes = await this.admin
      .from('bonus_allocations')
      .select('calculation_run_id, final_amount_minor')
      .eq('organization_id', org);
    if (allocRes.error) throw toDomainError(allocRes.error);
    const allocations = (allocRes.data ?? []) as AllocRow[];

    const snapByRun = new Map(snapshots.map((s) => [s.calculation_run_id, s]));
    const finalSumByRun = new Map<string, number>();
    for (const a of allocations) {
      finalSumByRun.set(
        a.calculation_run_id,
        (finalSumByRun.get(a.calculation_run_id) ?? 0) +
          toMinorAmount(a.final_amount_minor, 'final_amount_minor'),
      );
    }

    const findings: ReconciliationFinding[] = [];
    for (const run of runs) {
      const snap = snapByRun.get(run.id);
      if (!snap) continue; // missing snapshot is reported by checkMissingSnapshot
      const poolRef = poolRefOf(snap);
      if (Number.isNaN(poolRef)) continue; // no pool_ref basis → not an SI-13 subject
      const actualSum =
        (finalSumByRun.get(run.id) ?? 0) +
        toMinorAmount(snap.undistributed_remainder_minor, 'undistributed_remainder_minor');
      if (actualSum !== poolRef) {
        findings.push({
          invariant: 'INV-SI13-POOL-SUM',
          severity: INVARIANT_SEVERITY['INV-SI13-POOL-SUM'],
          details: { runId: run.id, periodId: run.bonus_period_id, actualSum, expectedPoolRef: poolRef },
        });
      }
    }
    return findings;
  }

  // INV-LEDGER-BALANCE: Σdebit = Σcredit per (org, transaction_id).
  async checkLedgerBalance(ctx: ReconciliationContext): Promise<ReconciliationFinding[]> {
    const { data, error } = await this.admin
      .from('bonus_ledger')
      .select('transaction_id, entry_type, amount_minor')
      .eq('organization_id', ctx.organizationId);
    if (error) throw toDomainError(error);
    const rows = (data ?? []) as Pick<LedgerRow, 'transaction_id' | 'entry_type' | 'amount_minor'>[];

    const byTxn = new Map<string, { debit: number; credit: number }>();
    for (const r of rows) {
      const acc = byTxn.get(r.transaction_id) ?? { debit: 0, credit: 0 };
      if (r.entry_type === 'debit') acc.debit += toMinorAmount(r.amount_minor, 'amount_minor');
      else if (r.entry_type === 'credit') acc.credit += toMinorAmount(r.amount_minor, 'amount_minor');
      byTxn.set(r.transaction_id, acc);
    }

    const findings: ReconciliationFinding[] = [];
    for (const [transactionId, { debit, credit }] of byTxn) {
      if (debit !== credit) {
        findings.push({
          invariant: 'INV-LEDGER-BALANCE',
          severity: INVARIANT_SEVERITY['INV-LEDGER-BALANCE'],
          details: { transactionId, totalDebit: debit, totalCredit: credit },
        });
      }
    }
    return findings;
  }

  // INV-MISSING-SNAPSHOT: a completed run without a snapshot row.
  async checkMissingSnapshot(ctx: ReconciliationContext): Promise<ReconciliationFinding[]> {
    const org = ctx.organizationId;
    const runs = await this.completedRuns(org);
    if (runs.length === 0) return [];

    const { data, error } = await this.admin
      .from('bonus_allocation_snapshots')
      .select('calculation_run_id')
      .eq('organization_id', org);
    if (error) throw toDomainError(error);
    const snapRunIds = new Set(
      ((data ?? []) as Pick<SnapshotRow, 'calculation_run_id'>[]).map((s) => s.calculation_run_id),
    );

    return runs
      .filter((run) => !snapRunIds.has(run.id))
      .map((run) => ({
        invariant: 'INV-MISSING-SNAPSHOT' as const,
        severity: INVARIANT_SEVERITY['INV-MISSING-SNAPSHOT'],
        details: { runId: run.id, periodId: run.bonus_period_id },
      }));
  }

  // INV-DUPLICATE-ACCRUAL: one snapshot accrued under >1 transaction_ids (pool-debit accrual rows).
  async checkDuplicateAccrual(ctx: ReconciliationContext): Promise<ReconciliationFinding[]> {
    const { data, error } = await this.admin
      .from('bonus_ledger')
      .select('snapshot_id, transaction_id')
      .eq('organization_id', ctx.organizationId)
      .eq('event_type', 'bonus_accrual')
      .eq('account', 'pool')
      .eq('entry_type', 'debit');
    if (error) throw toDomainError(error);
    const rows = (data ?? []) as Pick<LedgerRow, 'snapshot_id' | 'transaction_id'>[];

    const txnsBySnap = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.snapshot_id) continue;
      const set = txnsBySnap.get(r.snapshot_id) ?? new Set<string>();
      set.add(r.transaction_id);
      txnsBySnap.set(r.snapshot_id, set);
    }

    const findings: ReconciliationFinding[] = [];
    for (const [snapshotId, txns] of txnsBySnap) {
      if (txns.size > 1) {
        findings.push({
          invariant: 'INV-DUPLICATE-ACCRUAL',
          severity: INVARIANT_SEVERITY['INV-DUPLICATE-ACCRUAL'],
          details: { snapshotId, accrualCount: txns.size },
        });
      }
    }
    return findings;
  }

  // INV-BL2-OVERACCRUAL: Σ(accrual credit amount) per snapshot ≤ pool_ref_minor (BL-2 / 0022).
  async checkBL2Overaccrual(ctx: ReconciliationContext): Promise<ReconciliationFinding[]> {
    const org = ctx.organizationId;
    const ledgerRes = await this.admin
      .from('bonus_ledger')
      .select('snapshot_id, amount_minor')
      .eq('organization_id', org)
      .eq('event_type', 'bonus_accrual')
      .eq('account', 'accrual')
      .eq('entry_type', 'credit');
    if (ledgerRes.error) throw toDomainError(ledgerRes.error);
    const ledger = (ledgerRes.data ?? []) as Pick<LedgerRow, 'snapshot_id' | 'amount_minor'>[];

    const accruedBySnap = new Map<string, number>();
    for (const r of ledger) {
      if (!r.snapshot_id) continue;
      accruedBySnap.set(
        r.snapshot_id,
        (accruedBySnap.get(r.snapshot_id) ?? 0) + toMinorAmount(r.amount_minor, 'amount_minor'),
      );
    }
    if (accruedBySnap.size === 0) return [];

    const snapsRes = await this.admin
      .from('bonus_allocation_snapshots')
      .select('id, calculation_metadata')
      .eq('organization_id', org);
    if (snapsRes.error) throw toDomainError(snapsRes.error);
    const poolRefBySnap = new Map(
      ((snapsRes.data ?? []) as Pick<SnapshotRow, 'id' | 'calculation_metadata'>[]).map((s) => [
        s.id,
        poolRefOf(s as SnapshotRow),
      ]),
    );

    const findings: ReconciliationFinding[] = [];
    for (const [snapshotId, totalAccrued] of accruedBySnap) {
      const poolRef = poolRefBySnap.get(snapshotId);
      if (poolRef == null || Number.isNaN(poolRef)) continue;
      if (totalAccrued > poolRef) {
        findings.push({
          invariant: 'INV-BL2-OVERACCRUAL',
          severity: INVARIANT_SEVERITY['INV-BL2-OVERACCRUAL'],
          details: { snapshotId, totalAccrued, poolRef },
        });
      }
    }
    return findings;
  }
}

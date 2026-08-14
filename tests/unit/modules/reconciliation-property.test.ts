import { describe, expect, it } from 'vitest';
import { ReconciliationRepository } from '@/modules/reconciliation';

// ENGINEERING-06 Track A. Runs the REAL ReconciliationRepository aggregate logic against a fake
// admin client — the runtime coverage that 05 could not have (05 mocked the repo). Column shapes
// verified against migrations 0013/0014/0021. Property-style: hand-designed case sets that push
// each invariant's boundary (exact match, off-by-one, empty, multi-run).

type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;
type MockRow = Record<string, unknown>;

/** Fake admin client: .from(t) → fluent thenable resolving to { data: tables[t] ?? [], error: null }. */
function mockAdmin(tables: Record<string, MockRow[]>): AdminClient {
  return {
    from(tableName: string) {
      const result = { data: tables[tableName] ?? [], error: null };
      const b: Record<string, unknown> = { select: () => b, eq: () => b };
      const p = Promise.resolve(result);
      b.then = p.then.bind(p);
      b.catch = p.catch.bind(p);
      return b;
    },
  } as unknown as AdminClient;
}

const CTX = { organizationId: 'o1', userId: 'u1' };
const repo = (tables: Record<string, MockRow[]>) => new ReconciliationRepository(mockAdmin(tables));

const RUN1 = { id: 'run1', bonus_period_id: 'per1', status: 'completed' };
const RUN2 = { id: 'run2', bonus_period_id: 'per2', status: 'completed' };

describe('checkPoolSum (INV-SI13-POOL-SUM)', () => {
  it('D1/SI-13: no completed runs → 0 findings', async () => {
    const r = await repo({ bonus_calculation_runs: [], bonus_allocation_snapshots: [], bonus_allocations: [] }).checkPoolSum(CTX);
    expect(r).toHaveLength(0);
  });

  it('D1/SI-13: Σfinal(500+500) + undistributed(200) = pool_ref(1200) → 0 findings', async () => {
    const r = await repo({
      bonus_calculation_runs: [RUN1],
      bonus_allocation_snapshots: [
        { id: 's1', calculation_run_id: 'run1', undistributed_remainder_minor: 200, calculation_metadata: { pool_ref_minor: 1200 } },
      ],
      bonus_allocations: [
        { calculation_run_id: 'run1', final_amount_minor: 500 },
        { calculation_run_id: 'run1', final_amount_minor: 500 },
      ],
    }).checkPoolSum(CTX);
    expect(r).toHaveLength(0);
  });

  it('D1/SI-13: off-by-one (pool_ref 1201 vs actual 1200) → 1 critical finding for run1', async () => {
    const r = await repo({
      bonus_calculation_runs: [RUN1],
      bonus_allocation_snapshots: [
        { id: 's1', calculation_run_id: 'run1', undistributed_remainder_minor: 200, calculation_metadata: { pool_ref_minor: 1201 } },
      ],
      bonus_allocations: [
        { calculation_run_id: 'run1', final_amount_minor: 500 },
        { calculation_run_id: 'run1', final_amount_minor: 500 },
      ],
    }).checkPoolSum(CTX);
    expect(r).toHaveLength(1);
    expect(r[0]!.invariant).toBe('INV-SI13-POOL-SUM');
    expect(r[0]!.severity).toBe('critical');
    expect(r[0]!.details).toMatchObject({ runId: 'run1', actualSum: 1200, expectedPoolRef: 1201 });
  });

  it('D6: fully undistributed (no allocations), undistributed = pool_ref → 0 findings', async () => {
    const r = await repo({
      bonus_calculation_runs: [RUN1],
      bonus_allocation_snapshots: [
        { id: 's1', calculation_run_id: 'run1', undistributed_remainder_minor: 1000, calculation_metadata: { pool_ref_minor: 1000 } },
      ],
      bonus_allocations: [],
    }).checkPoolSum(CTX);
    expect(r).toHaveLength(0);
  });

  it('D1/SI-13: two runs — one balanced, one unbalanced → exactly 1 finding (run2)', async () => {
    const r = await repo({
      bonus_calculation_runs: [RUN1, RUN2],
      bonus_allocation_snapshots: [
        { id: 's1', calculation_run_id: 'run1', undistributed_remainder_minor: 0, calculation_metadata: { pool_ref_minor: 1000 } },
        { id: 's2', calculation_run_id: 'run2', undistributed_remainder_minor: 0, calculation_metadata: { pool_ref_minor: 999 } },
      ],
      bonus_allocations: [
        { calculation_run_id: 'run1', final_amount_minor: 1000 },
        { calculation_run_id: 'run2', final_amount_minor: 1000 },
      ],
    }).checkPoolSum(CTX);
    expect(r).toHaveLength(1);
    expect(r[0]!.details).toMatchObject({ runId: 'run2' });
  });

  it('D1/SI-13: snapshot without pool_ref_minor → skipped (not an SI-13 subject) → 0 findings', async () => {
    const r = await repo({
      bonus_calculation_runs: [RUN1],
      bonus_allocation_snapshots: [
        { id: 's1', calculation_run_id: 'run1', undistributed_remainder_minor: 5, calculation_metadata: {} },
      ],
      bonus_allocations: [{ calculation_run_id: 'run1', final_amount_minor: 999 }],
    }).checkPoolSum(CTX);
    expect(r).toHaveLength(0);
  });
});

describe('checkLedgerBalance (INV-LEDGER-BALANCE)', () => {
  it('no entries → 0 findings', async () => {
    expect(await repo({ bonus_ledger: [] }).checkLedgerBalance(CTX)).toHaveLength(0);
  });

  it('balanced (debit 500 + credit 500, same txn) → 0 findings', async () => {
    const r = await repo({
      bonus_ledger: [
        { transaction_id: 't1', entry_type: 'debit', amount_minor: 500 },
        { transaction_id: 't1', entry_type: 'credit', amount_minor: 500 },
      ],
    }).checkLedgerBalance(CTX);
    expect(r).toHaveLength(0);
  });

  it('unbalanced by 1 kuruş (debit 501 vs credit 500) → 1 finding with debit/credit totals', async () => {
    const r = await repo({
      bonus_ledger: [
        { transaction_id: 't1', entry_type: 'debit', amount_minor: 501 },
        { transaction_id: 't1', entry_type: 'credit', amount_minor: 500 },
      ],
    }).checkLedgerBalance(CTX);
    expect(r).toHaveLength(1);
    expect(r[0]!.invariant).toBe('INV-LEDGER-BALANCE');
    expect(r[0]!.details).toMatchObject({ transactionId: 't1', totalDebit: 501, totalCredit: 500 });
  });

  it('two balanced txns → 0 findings', async () => {
    const r = await repo({
      bonus_ledger: [
        { transaction_id: 't1', entry_type: 'debit', amount_minor: 100 },
        { transaction_id: 't1', entry_type: 'credit', amount_minor: 100 },
        { transaction_id: 't2', entry_type: 'debit', amount_minor: 250 },
        { transaction_id: 't2', entry_type: 'credit', amount_minor: 250 },
      ],
    }).checkLedgerBalance(CTX);
    expect(r).toHaveLength(0);
  });

  it('1 balanced + 1 unbalanced → exactly 1 finding', async () => {
    const r = await repo({
      bonus_ledger: [
        { transaction_id: 't1', entry_type: 'debit', amount_minor: 100 },
        { transaction_id: 't1', entry_type: 'credit', amount_minor: 100 },
        { transaction_id: 't2', entry_type: 'debit', amount_minor: 250 },
        { transaction_id: 't2', entry_type: 'credit', amount_minor: 200 },
      ],
    }).checkLedgerBalance(CTX);
    expect(r).toHaveLength(1);
    expect(r[0]!.details).toMatchObject({ transactionId: 't2' });
  });
});

describe('checkMissingSnapshot (INV-MISSING-SNAPSHOT)', () => {
  it('no completed runs → 0 findings', async () => {
    expect(await repo({ bonus_calculation_runs: [], bonus_allocation_snapshots: [] }).checkMissingSnapshot(CTX)).toHaveLength(0);
  });

  it('run with snapshot → 0 findings', async () => {
    const r = await repo({
      bonus_calculation_runs: [RUN1],
      bonus_allocation_snapshots: [{ calculation_run_id: 'run1' }],
    }).checkMissingSnapshot(CTX);
    expect(r).toHaveLength(0);
  });

  it('run without snapshot → 1 warning finding', async () => {
    const r = await repo({
      bonus_calculation_runs: [RUN1],
      bonus_allocation_snapshots: [],
    }).checkMissingSnapshot(CTX);
    expect(r).toHaveLength(1);
    expect(r[0]!.invariant).toBe('INV-MISSING-SNAPSHOT');
    expect(r[0]!.severity).toBe('warning');
    expect(r[0]!.details).toMatchObject({ runId: 'run1' });
  });

  it('two runs — one has snapshot, one does not → 1 finding', async () => {
    const r = await repo({
      bonus_calculation_runs: [RUN1, RUN2],
      bonus_allocation_snapshots: [{ calculation_run_id: 'run1' }],
    }).checkMissingSnapshot(CTX);
    expect(r).toHaveLength(1);
    expect(r[0]!.details).toMatchObject({ runId: 'run2' });
  });
});

describe('checkDuplicateAccrual (INV-DUPLICATE-ACCRUAL)', () => {
  it('no accrual entries → 0 findings', async () => {
    expect(await repo({ bonus_ledger: [] }).checkDuplicateAccrual(CTX)).toHaveLength(0);
  });

  it('D9: one txn per snapshot → 0 findings', async () => {
    const r = await repo({
      bonus_ledger: [{ snapshot_id: 's1', transaction_id: 't1' }],
    }).checkDuplicateAccrual(CTX);
    expect(r).toHaveLength(0);
  });

  it('D9: snapshot accrued under 2 txn_ids → 1 critical finding (accrualCount 2)', async () => {
    const r = await repo({
      bonus_ledger: [
        { snapshot_id: 's1', transaction_id: 't1' },
        { snapshot_id: 's1', transaction_id: 't2' },
      ],
    }).checkDuplicateAccrual(CTX);
    expect(r).toHaveLength(1);
    expect(r[0]!.invariant).toBe('INV-DUPLICATE-ACCRUAL');
    expect(r[0]!.details).toMatchObject({ snapshotId: 's1', accrualCount: 2 });
  });

  it('D9: two snapshots each with 1 txn → 0 findings', async () => {
    const r = await repo({
      bonus_ledger: [
        { snapshot_id: 's1', transaction_id: 't1' },
        { snapshot_id: 's2', transaction_id: 't2' },
      ],
    }).checkDuplicateAccrual(CTX);
    expect(r).toHaveLength(0);
  });
});

describe('checkBL2Overaccrual (INV-BL2-OVERACCRUAL)', () => {
  it('D6/BL2: no accrual entries → 0 findings', async () => {
    const r = await repo({ bonus_ledger: [], bonus_allocation_snapshots: [] }).checkBL2Overaccrual(CTX);
    expect(r).toHaveLength(0);
  });

  it('D6/BL2: Σaccrual exactly = pool_ref → 0 findings (not strictly greater)', async () => {
    const r = await repo({
      bonus_ledger: [
        { snapshot_id: 's1', amount_minor: 600 },
        { snapshot_id: 's1', amount_minor: 400 },
      ],
      bonus_allocation_snapshots: [{ id: 's1', calculation_metadata: { pool_ref_minor: 1000 } }],
    }).checkBL2Overaccrual(CTX);
    expect(r).toHaveLength(0);
  });

  it('D6/BL2: Σaccrual > pool_ref by 1 → 1 critical finding (totalAccrued 1001)', async () => {
    const r = await repo({
      bonus_ledger: [{ snapshot_id: 's1', amount_minor: 1001 }],
      bonus_allocation_snapshots: [{ id: 's1', calculation_metadata: { pool_ref_minor: 1000 } }],
    }).checkBL2Overaccrual(CTX);
    expect(r).toHaveLength(1);
    expect(r[0]!.invariant).toBe('INV-BL2-OVERACCRUAL');
    expect(r[0]!.details).toMatchObject({ snapshotId: 's1', totalAccrued: 1001, poolRef: 1000 });
  });

  it('D6/BL2: Σaccrual < pool_ref → 0 findings', async () => {
    const r = await repo({
      bonus_ledger: [{ snapshot_id: 's1', amount_minor: 999 }],
      bonus_allocation_snapshots: [{ id: 's1', calculation_metadata: { pool_ref_minor: 1000 } }],
    }).checkBL2Overaccrual(CTX);
    expect(r).toHaveLength(0);
  });
});

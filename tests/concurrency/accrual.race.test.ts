import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, race } from './helpers/db';
import { reconcile } from './helpers/reconcile';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const HR_A = 'a0000000-0000-0000-0000-0000000000a3';
const FIN_A = 'a0000000-0000-0000-0000-0000000000a4';
const EMP_ALPHA = 'a0000000-0000-0000-0000-0000000000a7';

// Race 2 — two sessions post the accrual for the SAME snapshot simultaneously. Guard:
// uq_bonus_ledger_accrual_idem = unique(snapshot_id, employee_id, account) WHERE
// event_type='bonus_accrual' (0014). Each session writes a balanced accrual transaction (pool debit
// + per-employee accrual credit); the second session's per-employee CREDIT row collides on the
// unique index → its whole transaction rolls back. Expected: exactly ONE accrual credit per
// (snapshot, employee, account); no duplicate accrual; reconcile clean.
describe('Race 2 — accrual x2 (same snapshot)', () => {
  let admin: Client;
  const period = crypto.randomUUID();
  const pool = crypto.randomUUID();
  let snapshotId: string;
  let runId: string;

  beforeAll(async () => {
    admin = await connect();
    await admin.query(
      `insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
       values ($1::uuid,$2::uuid,'monthly',date '2026-08-01',date '2026-08-31','open',$3::uuid)`,
      [period, ORG_A, HR_A],
    );
    await admin.query(
      `insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
       values ($1::uuid,$2::uuid,$3::uuid,10000000,'TRY','draft',$4::uuid)`,
      [pool, ORG_A, period, FIN_A],
    );
    await admin.query(
      `update public.bonus_pools set status='locked', t_org=1, locked_at=now(), locked_by=$2::uuid where id=$1::uuid and status='draft'`,
      [pool, FIN_A],
    );
    await admin.query(
      `update public.bonus_periods set status='locked', locked_at=now(), locked_by=$2::uuid where id=$1::uuid and status='open'`,
      [period, HR_A],
    );
    // A completed run + snapshot with NO accrual yet (0 eligibility → 0 allocations, but the
    // snapshot row exists to hang the accrual off of).
    const idem = `concurrency-accrual-${crypto.randomUUID()}`;
    await admin.query('SELECT public.run_bonus_calculation($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid)', [
      ORG_A, period, pool, idem, HR_A,
    ]);
    const snap = await admin.query<{ id: string; calculation_run_id: string }>(
      `SELECT s.id, s.calculation_run_id
         FROM public.bonus_allocation_snapshots s
         JOIN public.bonus_calculation_runs r ON r.id = s.calculation_run_id
        WHERE r.idempotency_key=$1`,
      [idem],
    );
    snapshotId = snap.rows[0]!.id;
    runId = snap.rows[0]!.calculation_run_id;
  });

  afterAll(async () => {
    await admin.end();
  });

  it('posts the accrual exactly once for the shared snapshot + reconciles clean', async () => {
    const postAccrual = async (c: Client) => {
      const txn = crypto.randomUUID();
      await c.query('BEGIN');
      try {
        // Pool debit (employee null) — nulls are distinct under the unique index, so both sessions'
        // debits could insert, but the credit below is the real collision point.
        await c.query(
          `insert into public.bonus_ledger
             (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id,
              entry_type, account, event_type, amount_minor, currency, reason, created_by)
           values ($1::uuid,$2::uuid,null,$3::uuid,$4::uuid,$5::uuid,'debit','pool','bonus_accrual',1000,'TRY','race: pool debit',$6::uuid)`,
          [ORG_A, pool, runId, snapshotId, txn, FIN_A],
        );
        // Per-employee accrual credit — collides on uq_bonus_ledger_accrual_idem for the loser.
        await c.query(
          `insert into public.bonus_ledger
             (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id,
              entry_type, account, event_type, amount_minor, currency, reason, created_by)
           values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,'credit','accrual','bonus_accrual',1000,'TRY','race: emp credit',$7::uuid)`,
          [ORG_A, pool, EMP_ALPHA, runId, snapshotId, txn, FIN_A],
        );
        await c.query('COMMIT');
        return 'accrued';
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    };

    const [r1, r2] = await race(postAccrual, postAccrual);
    // Exactly one accrual survives; the other rolls back on the unique-index collision.
    expect([r1, r2].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect([r1, r2].filter((r) => r.status === 'rejected')).toHaveLength(1);

    const credits = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.bonus_ledger
        WHERE snapshot_id=$1::uuid AND employee_id=$2::uuid AND account='accrual' AND event_type='bonus_accrual'`,
      [snapshotId, EMP_ALPHA],
    );
    expect(credits.rows[0]!.n).toBe(1);

    const rec = await reconcile(admin, ORG_A);
    expect(rec.criticalFindings).toEqual([]);
  });
});

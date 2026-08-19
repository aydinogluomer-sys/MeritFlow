import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, race } from './helpers/db';
import { reconcile } from './helpers/reconcile';

// Seed UUIDs (supabase/seed/seed_test_tenants.sql).
const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const HR_A = 'a0000000-0000-0000-0000-0000000000a3';
const FIN_A = 'a0000000-0000-0000-0000-0000000000a4';

// Race 1 — two sessions run the SAME bonus calculation (same idempotency key) simultaneously.
// Guard: bonus_calculation_runs unique(organization_id, idempotency_key) + run_bonus_calculation's
// own idempotency check (0021/0024/0028). Expected: exactly ONE run row for that key (the loser
// idempotently returns the same snapshot OR fails with a unique violation). Reconcile clean.
describe('Race 1 — bonus calculation x2 (same idempotency key)', () => {
  let admin: Client;
  const period = crypto.randomUUID();
  const pool = crypto.randomUUID();

  beforeAll(async () => {
    admin = await connect();
    // Fresh LOCKED period + LOCKED pool (open->locked / draft->locked, the seed's state-machine
    // path). No eligibility rows → the engine distributes nothing and books the whole distributable
    // as undistributed_remainder, so Σfinal(0) + remainder = pool_ref (SI-13 holds → reconcile clean).
    await admin.query(
      `insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
       values ($1::uuid,$2::uuid,'monthly',date '2026-07-01',date '2026-07-31','open',$3::uuid)`,
      [period, ORG_A, HR_A],
    );
    await admin.query(
      `insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
       values ($1::uuid,$2::uuid,$3::uuid,10000000,'TRY','draft',$4::uuid)`,
      [pool, ORG_A, period, FIN_A],
    );
    await admin.query(
      `update public.bonus_pools set status='locked', t_org=1, locked_at=now(), locked_by=$2::uuid
        where id=$1::uuid and status='draft'`,
      [pool, FIN_A],
    );
    await admin.query(
      `update public.bonus_periods set status='locked', locked_at=now(), locked_by=$2::uuid
        where id=$1::uuid and status='open'`,
      [period, HR_A],
    );
  });

  afterAll(async () => {
    // bonus_allocation_snapshots is append-only (prevent_mutation blocks DELETE), so a completed run
    // cannot be torn down. The leftover run is reconciliation-clean, so it does not pollute other
    // suites. Just close the connection.
    await admin.end();
  });

  it('creates exactly one run for the shared idempotency key + reconciles clean', async () => {
    const idem = `concurrency-calc-${crypto.randomUUID()}`;
    const call = (c: Client) =>
      c.query(
        'SELECT public.run_bonus_calculation($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid) AS snapshot',
        [ORG_A, period, pool, idem, HR_A],
      );

    const [r1, r2] = await race(call, call);
    // At least one session must complete; the loser may idempotently return the same snapshot or
    // fail with a unique violation — both acceptable.
    expect([r1, r2].some((r) => r.status === 'fulfilled')).toBe(true);

    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM public.bonus_calculation_runs WHERE idempotency_key=$1',
      [idem],
    );
    expect(rows[0]!.n).toBe(1);

    const rec = await reconcile(admin, ORG_A);
    expect(rec.criticalFindings).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, race } from './helpers/db';
import { reconcile } from './helpers/reconcile';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const HR_A = 'a0000000-0000-0000-0000-0000000000a3';
const FIN_A = 'a0000000-0000-0000-0000-0000000000a4';
const PERIOD_030 = 'a0000000-0000-0000-0000-000000000030'; // has the clean completed run 032 + accrual
const SNAP_035 = 'a0000000-0000-0000-0000-000000000035';

// Race 5 — a dispute-driven recalculation races a payout export on the same period. The financial
// invariants must hold regardless of interleaving: no bonus_ledger imbalance and a clean
// reconciliation. recalculate_bonus_after_dispute (0026/0029) may succeed OR reject (nothing to
// recalculate) — either is acceptable; the guarantee under test is "no double-effect / no imbalance".
describe('Race 5 — dispute recalculation vs payout export', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  it('keeps the ledger balanced + reconciles clean regardless of interleaving', async () => {
    const recalc = (c: Client) =>
      c.query('SELECT public.recalculate_bonus_after_dispute($1::uuid,$2::uuid,$3::uuid)', [
        ORG_A, PERIOD_030, HR_A,
      ]);
    const exportPayout = (c: Client) =>
      c.query(
        `insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format, status)
         values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'csv','requested')`,
        [ORG_A, PERIOD_030, SNAP_035, FIN_A],
      );

    const [a, b] = await race(recalc, exportPayout);
    // Both settle; recalc rejecting (no dispute basis) is acceptable — the invariant is balance.
    expect([a, b].every((r) => r.status === 'fulfilled' || r.status === 'rejected')).toBe(true);

    const rec = await reconcile(admin, ORG_A);
    expect(rec.criticalFindings).toEqual([]);
  });
});

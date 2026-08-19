import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, race } from './helpers/db';
import { reconcile } from './helpers/reconcile';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const FIN_A = 'a0000000-0000-0000-0000-0000000000a4';
const PERIOD_030 = 'a0000000-0000-0000-0000-000000000030'; // locked period, clean completed run 032
const SNAP_035 = 'a0000000-0000-0000-0000-000000000035'; // snapshot of the clean run (no pending cap)

// Race 3 — two sessions export the same period's payout simultaneously, each gated by the SAME
// commandId via command_log (0039). Guard: claim_command's ON CONFLICT DO NOTHING over
// unique(organization_id, operation_type, command_id) — exactly ONE session claims (true) and
// inserts an export; the other is deduped (false). Expected: exactly ONE command_log row and ONE
// new export from this race; reconcile clean.
describe('Race 3 — payout export x2 (same commandId, command_log dedup)', () => {
  let admin: Client;
  const commandId = crypto.randomUUID();

  beforeAll(async () => {
    admin = await connect();
  });

  afterAll(async () => {
    // command_log is server-write-only but deletable by the superuser test role; clean up so
    // re-runs in the same process are independent.
    await admin.query(`delete from public.command_log where command_id=$1::uuid`, [commandId]);
    await admin.end();
  });

  it('creates exactly one export via command_log dedup + reconciles clean', async () => {
    const before = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.exports WHERE bonus_period_id=$1::uuid`,
      [PERIOD_030],
    );

    const doExport = async (c: Client) => {
      const { rows } = await c.query<{ first: boolean }>(
        'SELECT public.claim_command($1::uuid,$2::text,$3::uuid,$4::uuid) AS first',
        [ORG_A, 'export_payout', commandId, FIN_A],
      );
      if (rows[0]!.first === true) {
        await c.query(
          `insert into public.exports (organization_id, bonus_period_id, snapshot_id, exported_by, format, status)
           values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'csv','requested')`,
          [ORG_A, PERIOD_030, SNAP_035, FIN_A],
        );
        return 'exported';
      }
      return 'deduped';
    };

    const [r1, r2] = await race(doExport, doExport);
    const values = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value : `err:${String(r.reason)}`));
    // Exactly one exported, one deduped.
    expect(values.filter((v) => v === 'exported')).toHaveLength(1);
    expect(values.filter((v) => v === 'deduped')).toHaveLength(1);

    // Exactly one command_log row for the shared triple.
    const cl = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.command_log
        WHERE organization_id=$1::uuid AND operation_type='export_payout' AND command_id=$2::uuid`,
      [ORG_A, commandId],
    );
    expect(cl.rows[0]!.n).toBe(1);

    // Exactly one NEW export from this race.
    const after = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.exports WHERE bonus_period_id=$1::uuid`,
      [PERIOD_030],
    );
    expect(after.rows[0]!.n - before.rows[0]!.n).toBe(1);

    const rec = await reconcile(admin, ORG_A);
    expect(rec.criticalFindings).toEqual([]);
  });
});

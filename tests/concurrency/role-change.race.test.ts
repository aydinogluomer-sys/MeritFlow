import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, QueryResult } from 'pg';
import { connect, race } from './helpers/db';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const HR_A = 'a0000000-0000-0000-0000-0000000000a3';
const MGR_ALPHA = 'a0000000-0000-0000-0000-0000000000a5'; // actor (demoted mid-race)
const MGR_BETA = 'a0000000-0000-0000-0000-0000000000a6'; // second approver
const EMP_ALPHA = 'a0000000-0000-0000-0000-0000000000a7'; // adjustment target
const RACE_REASON = 'race: permission window';

// Race 7 — revoking a role races a privileged mutation that depends on that role. Guard: authz is
// re-checked inside the SECURITY DEFINER RPC against live memberships/role_permissions. Both
// outcomes are valid (the mutation either committed before the revoke, or was rejected 42501 after
// it). The invariant asserted is NO SILENT CORRUPTION: the count of ledger rows from this race is
// 0 or 1 — never a partial/duplicate write. (point.override is granted to 'manager' for the test so
// a real JWT actually exercises the permission check; trusted/null-uid context would bypass it.)
describe('Race 7 — permission revoke vs privileged mutation', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await connect();
    // Test-only: give 'manager' point.override so mgr-alpha/mgr-beta hold it under a real JWT.
    await admin.query(
      `insert into public.role_permissions (role_key, permission_key) values ('manager','point.override')
       on conflict (role_key, permission_key) do nothing`,
    );
  });

  afterAll(async () => {
    // Restore role + remove the test grant. The manual_adjustment ledger row (if any) is append-only
    // and stays, isolated by its RACE_REASON marker; a fresh CI db reset clears everything.
    await admin.query(
      `update public.memberships set primary_role='manager' where organization_id=$1::uuid and profile_id=$2::uuid`,
      [ORG_A, MGR_ALPHA],
    );
    await admin.query(
      `delete from public.role_permissions where role_key='manager' and permission_key='point.override'`,
    );
    await admin.end();
  });

  it('never writes a partial/duplicate ledger row (0 or 1) under a concurrent role revoke', async () => {
    const revokeRole = (c: Client) =>
      c.query(
        `update public.memberships set primary_role='employee' where organization_id=$1::uuid and profile_id=$2::uuid`,
        [ORG_A, MGR_ALPHA],
      );
    const privilegedMutation = async (c: Client) => {
      // Act as mgr-alpha so the RPC's has_permission('point.override') check is live.
      await c.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ sub: MGR_ALPHA }),
      ]);
      return c.query(
        `SELECT public.apply_manual_point_adjustment($1::uuid,$2::uuid,$3::numeric,$4::text,$5::uuid,$6::uuid)`,
        [ORG_A, EMP_ALPHA, 25, RACE_REASON, MGR_ALPHA, MGR_BETA],
      );
    };

    const [revokeRes, mutRes] = await race(revokeRole, privilegedMutation);
    // Both settle; the mutation is either fulfilled (ran before revoke) or rejected (42501 after).
    expect(revokeRes.status).toBe('fulfilled');
    expect(['fulfilled', 'rejected']).toContain(mutRes.status);

    // No silent corruption: at most one ledger row from this race.
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.point_ledger
        WHERE organization_id=$1::uuid AND employee_id=$2::uuid AND event_type='manual_adjustment' AND reason=$3`,
      [ORG_A, EMP_ALPHA, RACE_REASON],
    );
    expect(rows[0]!.n).toBeLessThanOrEqual(1);
    // The row count must match the mutation outcome exactly (no partial write).
    expect(rows[0]!.n).toBe(mutRes.status === 'fulfilled' ? 1 : 0);
  });
});

// Race 8 — two sessions accept the same pending invitation simultaneously via a guarded UPDATE.
// Guard: UPDATE ... WHERE status='pending' — exactly ONE session flips pending→accepted (1 row);
// the other finds nothing (0 rows). No duplicate acceptance.
describe('Race 8 — invitation double-accept', () => {
  let admin: Client;
  const token = crypto.randomUUID();

  beforeAll(async () => {
    admin = await connect();
    await admin.query(
      `insert into public.invitations (organization_id, invited_by, email, role, token, status)
       values ($1::uuid,$2::uuid,'race-invite@acme.test','employee',$3::uuid,'pending')`,
      [ORG_A, HR_A, token],
    );
  });

  afterAll(async () => {
    await admin.query(`delete from public.invitations where token=$1::uuid`, [token]);
    await admin.end();
  });

  it('lets exactly one session accept (1 row) and the other finds none (0 rows)', async () => {
    const accept = (c: Client) =>
      c.query(`update public.invitations set status='accepted' where token=$1::uuid and status='pending'`, [
        token,
      ]);

    const [r1, r2] = await race(accept, accept);
    const affected = [r1, r2]
      .map((r) => (r.status === 'fulfilled' ? (r.value as QueryResult).rowCount ?? 0 : -1))
      .sort();
    // Exactly one UPDATE touched a row; the other touched none.
    expect(affected).toEqual([0, 1]);

    const status = await admin.query<{ status: string }>(
      `SELECT status FROM public.invitations WHERE token=$1::uuid`,
      [token],
    );
    expect(status.rows[0]!.status).toBe('accepted');
  });
});

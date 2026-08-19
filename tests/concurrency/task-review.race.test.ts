import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, race } from './helpers/db';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const HR_A = 'a0000000-0000-0000-0000-0000000000a3';
const MGR_A = 'a0000000-0000-0000-0000-0000000000a5';
const EMP_ALPHA = 'a0000000-0000-0000-0000-0000000000a7';
const TEAM_F1 = 'a0000000-0000-0000-0000-0000000000f1';
const POLICY_V = 'a0000000-0000-0000-0000-0000000000d2';

async function createTask(admin: Client, id: string): Promise<void> {
  await admin.query(
    `insert into public.tasks
       (id, organization_id, team_id, title, status, created_by, assigned_to,
        complexity, impact, base_points, scoring_policy_version_id)
     values ($1::uuid,$2::uuid,$3::uuid,'concurrency task','assigned',$4::uuid,$5::uuid,'low','low',100,$6::uuid)`,
    [id, ORG_A, TEAM_F1, MGR_A, EMP_ALPHA, POLICY_V],
  );
}

// Race 4 — two sessions write the task_approved earning row for the SAME task simultaneously.
// Guard: point_ledger_task_approved_uq = unique(task_id) WHERE event_type='task_approved' (SI-1,
// 0020). Expected: exactly ONE task_approved point_ledger row for the task (loser hits 23505).
describe('Race 4 — task approval x2 (same task)', () => {
  let admin: Client;
  const taskId = crypto.randomUUID();

  beforeAll(async () => {
    admin = await connect();
    await createTask(admin, taskId);
  });

  afterAll(async () => {
    // point_ledger is append-only (cannot delete the earning row); the task row is disposable but a
    // fresh db reset resets everything in CI. Just close the connection.
    await admin.end();
  });

  it('records exactly one task_approved earning row for the task', async () => {
    const approve = (c: Client) =>
      c.query(
        `insert into public.point_ledger
           (organization_id, employee_id, event_type, points_delta, reason, task_id, scoring_policy_version_id, created_by)
         values ($1::uuid,$2::uuid,'task_approved',100,'race: task approved',$3::uuid,$4::uuid,$5::uuid)`,
        [ORG_A, EMP_ALPHA, taskId, POLICY_V, MGR_A],
      );

    const [r1, r2] = await race(approve, approve);
    expect([r1, r2].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect([r1, r2].filter((r) => r.status === 'rejected')).toHaveLength(1);

    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.point_ledger WHERE task_id=$1::uuid AND event_type='task_approved'`,
      [taskId],
    );
    expect(rows[0]!.n).toBe(1);
  });
});

// Race 6 — a period lock races a task approval. OBSERVATION (spec-permitted): the schema has NO
// DB-level guard that prevents scoring a task once its period is locked (task_approved rows are not
// keyed to a period; the lock gates calculation, not scoring). This test documents that gap — both
// the lock and the earning row land — WITHOUT adding a guard (out of scope). A future slice should
// decide whether post-lock scoring must be blocked at the DB level.
describe('Race 6 — period lock vs task approval (documented observation)', () => {
  let admin: Client;
  const period = crypto.randomUUID();
  const taskId = crypto.randomUUID();

  beforeAll(async () => {
    admin = await connect();
    await admin.query(
      `insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
       values ($1::uuid,$2::uuid,'monthly',date '2026-09-01',date '2026-09-30','open',$3::uuid)`,
      [period, ORG_A, HR_A],
    );
    await createTask(admin, taskId);
  });

  afterAll(async () => {
    await admin.end();
  });

  it('does not block task scoring on period lock (no DB guard — gap recorded, not fixed here)', async () => {
    const lockPeriod = (c: Client) =>
      c.query(
        `update public.bonus_periods set status='locked', locked_at=now(), locked_by=$2::uuid where id=$1::uuid and status='open'`,
        [period, HR_A],
      );
    const approveTask = (c: Client) =>
      c.query(
        `insert into public.point_ledger
           (organization_id, employee_id, event_type, points_delta, reason, task_id, scoring_policy_version_id, created_by)
         values ($1::uuid,$2::uuid,'task_approved',100,'race: approve during lock',$3::uuid,$4::uuid,$5::uuid)`,
        [ORG_A, EMP_ALPHA, taskId, POLICY_V, MGR_A],
      );

    const [lockRes, approveRes] = await race(lockPeriod, approveTask);
    // Both land — there is no cross-guard today. This is the recorded observation.
    expect(lockRes.status).toBe('fulfilled');
    expect(approveRes.status).toBe('fulfilled');

    const locked = await admin.query<{ status: string }>(
      `SELECT status FROM public.bonus_periods WHERE id=$1::uuid`,
      [period],
    );
    expect(locked.rows[0]!.status).toBe('locked');
    const earned = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.point_ledger WHERE task_id=$1::uuid AND event_type='task_approved'`,
      [taskId],
    );
    expect(earned.rows[0]!.n).toBe(1); // OBSERVATION: scoring succeeded despite the lock.
  });
});

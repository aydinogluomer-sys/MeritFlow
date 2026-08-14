import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { createTask } from '@/app/actions/tasks/create-task';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createClientMock = vi.mocked(createClient);

const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const ASSIGNEE_ID = '33333333-3333-4333-8333-333333333333';
const NEW_TASK_ID = '44444444-4444-4444-8444-444444444444';
const PV_ID = '55555555-5555-4555-8555-555555555555';

/**
 * Builds a supabase client mock where:
 *   from('scoring_policy_versions').select().eq().eq().order().limit().maybeSingle()
 *     -> { data: version, error: null }
 *   from('tasks').insert().select().single()
 *     -> { data: { id }, error: taskError }
 */
function mockClient(opts: {
  version?: { id: string } | null;
  versionError?: unknown;
  taskError?: unknown;
}) {
  const versionData = 'version' in opts ? opts.version : { id: PV_ID };
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: versionData, error: opts.versionError ?? null });
  const limit = vi.fn().mockReturnValue({ maybeSingle });
  const order = vi.fn().mockReturnValue({ limit });
  const eqV2 = vi.fn().mockReturnValue({ order });
  const eqV1 = vi.fn().mockReturnValue({ eq: eqV2 });
  const selectVersion = vi.fn().mockReturnValue({ eq: eqV1 });

  const single = vi
    .fn()
    .mockResolvedValue({ data: { id: NEW_TASK_ID }, error: opts.taskError ?? null });
  const selectTask = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select: selectTask });

  const from = vi.fn((table: string) => {
    if (table === 'scoring_policy_versions') return { select: selectVersion };
    if (table === 'tasks') return { insert };
    throw new Error(`unexpected table ${table}`);
  });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, insert, single };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({
    organization_id: 'o1',
    profile_id: 'p1',
    primary_role: 'owner',
  } as never);
  getUserMock.mockResolvedValue({ id: 'u1' } as never);
});

const base = {
  title: 'Test task',
  teamId: TEAM_ID,
  complexity: 'medium' as const,
  impact: 'high' as const,
  basePoints: 10,
};

describe('createTask', () => {
  it('happy path (unassigned): requires task.create only, inserts with status=assigned, self-assigns', async () => {
    const { from, insert } = mockClient({});
    const res = await createTask(base);

    expect(res).toEqual({ ok: true, data: { taskId: NEW_TASK_ID } });
    expect(requirePermissionMock).toHaveBeenCalledWith('task.create');
    expect(requirePermissionMock).not.toHaveBeenCalledWith('task.assign');
    expect(from).toHaveBeenCalledWith('tasks');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'o1',
        team_id: TEAM_ID,
        title: 'Test task',
        status: 'assigned',
        created_by: 'u1',
        assigned_to: 'u1',
        base_points: 10,
        scoring_policy_version_id: PV_ID,
      }),
    );
  });

  it('assigned: also requires task.assign and uses the given assignee', async () => {
    const { insert } = mockClient({});
    const res = await createTask({ ...base, assignedTo: ASSIGNEE_ID });

    expect(res.ok).toBe(true);
    expect(requirePermissionMock).toHaveBeenCalledWith('task.create');
    expect(requirePermissionMock).toHaveBeenCalledWith('task.assign');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ assigned_to: ASSIGNEE_ID }),
    );
  });

  it('authz fail: no DB call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockClient({});
    const res = await createTask(base);

    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('no published policy version: ok:false NO_PUBLISHED_SCORING_POLICY, no insert', async () => {
    const { insert } = mockClient({ version: null });
    const res = await createTask(base);

    expect(res).toEqual({ ok: false, error: 'NO_PUBLISHED_SCORING_POLICY' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('Zod: invalid complexity -> VALIDATION_ERROR, no DB call', async () => {
    const { from } = mockClient({});
    const res = await createTask({ ...base, complexity: 'nope' } as never);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('VALIDATION_ERROR');
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error on insert: ok:false with the DB message', async () => {
    mockClient({ taskError: { message: 'X' } });
    const res = await createTask(base);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

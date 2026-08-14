import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { manualOverride } from '@/app/actions/points/manual-override';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createAdminClientMock = vi.mocked(createAdminClient);

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_APPROVER_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';

function mockRpc(result: { data?: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? 'res', error: result.error });
  createAdminClientMock.mockReturnValue({ rpc } as never);
  return { rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({
    organization_id: 'o1',
    profile_id: 'p1',
    primary_role: 'hr',
  } as never);
  getUserMock.mockResolvedValue({ id: 'u1' } as never);
});

describe('manualOverride', () => {
  const base = {
    employeeId: EMPLOYEE_ID,
    pointsDelta: 5,
    reason: 'correction',
    secondApproverId: SECOND_APPROVER_ID,
    taskId: TASK_ID,
  };

  it('happy path: rpc apply_manual_point_adjustment with actor/second_approver/task_id', async () => {
    const { rpc } = mockRpc({ data: 'ledger1', error: null });
    const res = await manualOverride(base);

    expect(res).toEqual({ ok: true, data: { ledgerId: 'ledger1' } });
    expect(requirePermissionMock).toHaveBeenCalledWith('point.override');
    expect(rpc).toHaveBeenCalledWith(
      'apply_manual_point_adjustment',
      expect.objectContaining({
        p_actor: 'u1',
        p_second_approver: SECOND_APPROVER_ID,
        p_task_id: TASK_ID,
      }),
    );
  });

  it('taskId omitted -> p_task_id null', async () => {
    const { rpc } = mockRpc({ data: 'ledger1', error: null });
    const { taskId: _omit, ...noTask } = base;
    void _omit;
    await manualOverride(noTask);

    expect(rpc).toHaveBeenCalledWith(
      'apply_manual_point_adjustment',
      expect.objectContaining({ p_task_id: null }),
    );
  });

  it('authz fail: no rpc, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { rpc } = mockRpc({ error: null });
    const res = await manualOverride(base);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rpc error: ok:false with the message', async () => {
    mockRpc({ error: { message: 'X' } });
    const res = await manualOverride(base);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

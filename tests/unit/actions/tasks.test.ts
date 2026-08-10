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
import { createClient } from '@/lib/supabase/server';
import { submitTask } from '@/app/actions/tasks/submit-task';
import { reviewTask } from '@/app/actions/tasks/review-task';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createClientMock = vi.mocked(createClient);

const TASK_ID = '11111111-1111-4111-8111-111111111111';

// --- chain builders -------------------------------------------------------

/** tasks.update().eq().eq().eq() -> { error } (last eq resolves) */
function mockUpdateChain(result: { error: unknown }) {
  const eq3 = vi.fn().mockResolvedValue(result);
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const update = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ update });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, update, eq1 };
}

/** task_reviews.insert() -> { error } */
function mockInsertChain(result: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ insert });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, insert };
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

describe('submitTask', () => {
  it('happy path: requires task.submit and updates tasks -> submitted', async () => {
    const { from, update } = mockUpdateChain({ error: null });
    const res = await submitTask({ taskId: TASK_ID });

    expect(res).toEqual({ ok: true, data: { taskId: TASK_ID } });
    expect(requirePermissionMock).toHaveBeenCalledWith('task.submit');
    expect(from).toHaveBeenCalledWith('tasks');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted' }));
  });

  it('authz fail: no DB call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockUpdateChain({ error: null });
    const res = await submitTask({ taskId: TASK_ID });

    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error: ok:false with the DB message', async () => {
    mockUpdateChain({ error: { message: 'X' } });
    const res = await submitTask({ taskId: TASK_ID });
    expect(res).toEqual({ ok: false, error: 'X' });
  });
});

describe('reviewTask', () => {
  const base = {
    taskId: TASK_ID,
    decision: 'approve' as const,
    quality: 'good' as const,
    timeliness: 'on_time' as const,
    reviewerNote: 'looks good',
  };

  it('happy path: inserts into task_reviews with reviewer_note key', async () => {
    const { from, insert } = mockInsertChain({ error: null });
    const res = await reviewTask(base);

    expect(res).toEqual({ ok: true, data: { taskId: TASK_ID } });
    expect(requirePermissionMock).toHaveBeenCalledWith('task.review');
    expect(from).toHaveBeenCalledWith('task_reviews');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'approve',
        quality: 'good',
        timeliness: 'on_time',
        reviewer_note: 'looks good',
      }),
    );
    // regression: the column is reviewer_note, not notes
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('notes');
  });

  it('D3: approve + quality=poor -> APPROVE_POOR_FORBIDDEN, insert NOT called', async () => {
    const { insert } = mockInsertChain({ error: null });
    const res = await reviewTask({ ...base, decision: 'approve', quality: 'poor' });

    expect(res).toEqual({ ok: false, error: 'APPROVE_POOR_FORBIDDEN' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('authz fail: no DB call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockInsertChain({ error: null });
    const res = await reviewTask(base);

    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error: ok:false with the DB message', async () => {
    mockInsertChain({ error: { message: 'X' } });
    const res = await reviewTask(base);
    expect(res).toEqual({ ok: false, error: 'X' });
  });
});

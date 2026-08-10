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
import { createAdminClient } from '@/lib/supabase/admin';
import { openDispute } from '@/app/actions/disputes/open-dispute';
import { assignReviewer } from '@/app/actions/disputes/assign-reviewer';
import { resolveDispute } from '@/app/actions/disputes/resolve-dispute';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const DISPUTE_ID = '22222222-2222-4222-8222-222222222222';
const REVIEWER_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_ID = '44444444-4444-4444-8444-444444444444';

/** disputes.insert().select().single() -> { data, error } */
function mockInsertSelectSingle(result: { data?: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue({ data: result.data ?? { id: 'd1' }, error: result.error });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, insert };
}

/** disputes.update().eq().eq()[.eq()] -> { error } (deepest eq resolves) */
function mockUpdateChain(result: { error: unknown }, eqDepth = 3) {
  const resolving = vi.fn().mockResolvedValue(result);
  // build eq chain of the requested depth; deepest resolves, others return next
  let chain: { eq: ReturnType<typeof vi.fn> } = { eq: resolving };
  const eqMocks: ReturnType<typeof vi.fn>[] = [resolving];
  for (let i = 1; i < eqDepth; i++) {
    const next = chain;
    const eq = vi.fn().mockReturnValue(next);
    chain = { eq };
    eqMocks.unshift(eq);
  }
  const update = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ update });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, update };
}

/** admin.rpc(name, args) -> { data, error } */
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

describe('openDispute', () => {
  const input = { taskId: TASK_ID, disputeType: 'task_points_too_low' as const };

  it('happy path: inserts into disputes with target/complainant, no description', async () => {
    const { from, insert } = mockInsertSelectSingle({ data: { id: 'd1' }, error: null });
    const res = await openDispute(input);

    expect(res).toEqual({ ok: true, data: 'd1' });
    expect(requirePermissionMock).toHaveBeenCalledWith('dispute.open');
    expect(from).toHaveBeenCalledWith('disputes');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        dispute_type: 'task_points_too_low',
        target_type: 'task',
        target_id: TASK_ID,
        complainant_id: 'u1',
      }),
    );
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('description');
  });

  it('authz fail: no DB call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockInsertSelectSingle({ error: null });
    const res = await openDispute(input);
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error: ok:false with the message', async () => {
    mockInsertSelectSingle({ data: null, error: { message: 'X' } });
    const res = await openDispute(input);
    expect(res).toEqual({ ok: false, error: 'X' });
  });
});

describe('assignReviewer', () => {
  const input = { disputeId: DISPUTE_ID, reviewerId: REVIEWER_ID };

  it('happy path: updates disputes -> under_review with assigned_reviewer_id', async () => {
    const { from, update } = mockUpdateChain({ error: null }, 2);
    const res = await assignReviewer(input);

    expect(res).toEqual({ ok: true, data: { disputeId: DISPUTE_ID } });
    expect(requirePermissionMock).toHaveBeenCalledWith('dispute.resolve');
    expect(from).toHaveBeenCalledWith('disputes');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'under_review',
        assigned_reviewer_id: REVIEWER_ID,
      }),
    );
  });

  it('authz fail: no DB call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockUpdateChain({ error: null }, 2);
    const res = await assignReviewer(input);
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error: ok:false with the message', async () => {
    mockUpdateChain({ error: { message: 'X' } }, 2);
    const res = await assignReviewer(input);
    expect(res).toEqual({ ok: false, error: 'X' });
  });
});

describe('resolveDispute', () => {
  const rejectInput = {
    disputeId: DISPUTE_ID,
    resolution: 'rejected' as const,
    decisionNote: 'not valid',
  };
  const acceptInput = {
    disputeId: DISPUTE_ID,
    resolution: 'accepted' as const,
    decisionNote: 'valid claim',
    pointsDelta: 10,
  };

  it('happy path: updates disputes -> resolved with resolution/decision_note/resolved_at', async () => {
    const { from, update } = mockUpdateChain({ error: null }, 3);
    mockRpc({ error: null });
    const res = await resolveDispute(rejectInput);

    expect(res).toEqual({ ok: true, data: { disputeId: DISPUTE_ID } });
    expect(requirePermissionMock).toHaveBeenCalledWith('dispute.resolve');
    expect(from).toHaveBeenCalledWith('disputes');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        resolution: 'rejected',
        decision_note: 'not valid',
        resolved_at: expect.any(String),
      }),
    );
  });

  it('rejected: neither RPC is called', async () => {
    mockUpdateChain({ error: null }, 3);
    const { rpc } = mockRpc({ error: null });
    await resolveDispute(rejectInput);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepted + pointsDelta: apply_dispute_point_adjustment called with p_actor', async () => {
    mockUpdateChain({ error: null }, 3);
    const { rpc } = mockRpc({ error: null });
    const res = await resolveDispute(acceptInput);

    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'apply_dispute_point_adjustment',
      expect.objectContaining({ p_actor: 'u1' }),
    );
    // no bonusPeriodId -> recalc NOT called
    const names = rpc.mock.calls.map((c) => c[0]);
    expect(names).not.toContain('recalculate_bonus_after_dispute');
  });

  it('accepted + pointsDelta + bonusPeriodId: recalculate_bonus_after_dispute also called', async () => {
    mockUpdateChain({ error: null }, 3);
    const { rpc } = mockRpc({ error: null });
    const res = await resolveDispute({ ...acceptInput, bonusPeriodId: PERIOD_ID });

    expect(res.ok).toBe(true);
    const names = rpc.mock.calls.map((c) => c[0]);
    expect(names).toContain('apply_dispute_point_adjustment');
    expect(names).toContain('recalculate_bonus_after_dispute');
  });

  it('authz fail: no DB/RPC call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockUpdateChain({ error: null }, 3);
    const { rpc } = mockRpc({ error: null });
    const res = await resolveDispute(acceptInput);

    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('DB error on update: ok:false, no RPC', async () => {
    mockUpdateChain({ error: { message: 'X' } }, 3);
    const { rpc } = mockRpc({ error: null });
    const res = await resolveDispute(acceptInput);

    expect(res).toEqual({ ok: false, error: 'X' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('RPC error: ok:false with the adjustment message', async () => {
    mockUpdateChain({ error: null }, 3);
    mockRpc({ error: { message: 'ADJ_FAIL' } });
    const res = await resolveDispute(acceptInput);
    expect(res).toEqual({ ok: false, error: 'ADJ_FAIL' });
  });
});

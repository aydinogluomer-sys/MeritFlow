import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DisputeAdjustmentRepository,
  DisputeContext,
  ResolveDisputeInput,
} from '@/modules/disputes';

// The application fns create `new DisputeRepository(await createClient())` internally, so we mock
// the server client (harmless stub) + the DisputeRepository class (its methods become spies).
// DisputeAdjustmentRepository is injected into resolveDispute, so we pass a hand-built mock.
const { openMock, assignReviewerMock, markResolvedMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
  assignReviewerMock: vi.fn(),
  markResolvedMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn().mockResolvedValue({}) }));
vi.mock('@/modules/disputes/repository/dispute-repository', () => ({
  DisputeRepository: vi.fn(() => ({
    open: openMock,
    assignReviewer: assignReviewerMock,
    markResolved: markResolvedMock,
  })),
}));

import { openDispute, assignReviewer, resolveDispute } from '@/modules/disputes';

beforeEach(() => vi.clearAllMocks());

const ctx: DisputeContext = { organizationId: 'o1', userId: 'u1' };

function adjRepoMock() {
  return {
    applyPointAdjustment: vi.fn().mockResolvedValue(undefined),
    recalculateAfterDispute: vi.fn().mockResolvedValue(undefined),
  };
}

describe('disputes module — openDispute', () => {
  const input = { taskId: 't1', disputeType: 'task_points_too_low' as const };

  it('happy path: returns the id from repo.open', async () => {
    openMock.mockResolvedValue('d1');
    const res = await openDispute(input, ctx);

    expect(res).toBe('d1');
    expect(openMock).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates the repo error', async () => {
    openMock.mockRejectedValue(new Error('X'));
    await expect(openDispute(input, ctx)).rejects.toThrow('X');
  });
});

describe('disputes module — assignReviewer', () => {
  const input = { disputeId: 'disp1', reviewerId: 'r1' };

  it('happy path: returns { disputeId } after repo.assignReviewer', async () => {
    assignReviewerMock.mockResolvedValue(undefined);
    const res = await assignReviewer(input, { organizationId: 'o1' });

    expect(res).toEqual({ disputeId: 'disp1' });
    expect(assignReviewerMock).toHaveBeenCalledWith(input, { organizationId: 'o1' });
  });

  it('propagates the repo error', async () => {
    assignReviewerMock.mockRejectedValue(new Error('Y'));
    await expect(assignReviewer(input, { organizationId: 'o1' })).rejects.toThrow('Y');
  });
});

describe('disputes module — resolveDispute', () => {
  it('rejected: marks resolved but never touches adjRepo', async () => {
    markResolvedMock.mockResolvedValue(undefined);
    const adj = adjRepoMock();
    const input: ResolveDisputeInput = {
      disputeId: 'disp1',
      resolution: 'rejected',
      decisionNote: 'not valid',
    };

    const res = await resolveDispute(input, ctx, adj as unknown as DisputeAdjustmentRepository);

    expect(res).toEqual({ disputeId: 'disp1' });
    expect(markResolvedMock).toHaveBeenCalledWith(input, ctx);
    expect(adj.applyPointAdjustment).not.toHaveBeenCalled();
    expect(adj.recalculateAfterDispute).not.toHaveBeenCalled();
  });

  it('accepted + pointsDelta, no bonusPeriodId: adjustment only, no recalc', async () => {
    markResolvedMock.mockResolvedValue(undefined);
    const adj = adjRepoMock();
    const input: ResolveDisputeInput = {
      disputeId: 'disp1',
      resolution: 'accepted',
      decisionNote: 'valid claim',
      pointsDelta: 10,
    };

    await resolveDispute(input, ctx, adj as unknown as DisputeAdjustmentRepository);

    expect(adj.applyPointAdjustment).toHaveBeenCalledWith(input, ctx);
    expect(adj.recalculateAfterDispute).not.toHaveBeenCalled();
  });

  it('accepted + pointsDelta + bonusPeriodId: adjustment AND recalc', async () => {
    markResolvedMock.mockResolvedValue(undefined);
    const adj = adjRepoMock();
    const input: ResolveDisputeInput = {
      disputeId: 'disp1',
      resolution: 'accepted',
      decisionNote: 'valid claim',
      pointsDelta: 10,
      bonusPeriodId: 'per1',
    };

    await resolveDispute(input, ctx, adj as unknown as DisputeAdjustmentRepository);

    expect(adj.applyPointAdjustment).toHaveBeenCalledWith(input, ctx);
    expect(adj.recalculateAfterDispute).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates markResolved error before any adjustment', async () => {
    markResolvedMock.mockRejectedValue(new Error('UPDATE_FAIL'));
    const adj = adjRepoMock();
    const input: ResolveDisputeInput = {
      disputeId: 'disp1',
      resolution: 'accepted',
      decisionNote: 'valid claim',
      pointsDelta: 10,
    };

    await expect(
      resolveDispute(input, ctx, adj as unknown as DisputeAdjustmentRepository),
    ).rejects.toThrow('UPDATE_FAIL');
    expect(adj.applyPointAdjustment).not.toHaveBeenCalled();
  });
});

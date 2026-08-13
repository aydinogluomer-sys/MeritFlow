import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manualOverride, type PointLedgerRepository } from '@/modules/point-ledger';

beforeEach(() => vi.clearAllMocks());

const input = {
  employeeId: 'e1',
  pointsDelta: 5,
  reason: 'correction',
  secondApproverId: 'a1',
  taskId: 't1',
};
const ctx = { organizationId: 'o1', userId: 'u1' };

describe('point-ledger module — manualOverride', () => {
  it('happy path: returns the ledger id from the injected repository', async () => {
    const repo = {
      applyManualAdjustment: vi.fn().mockResolvedValue('ledger1'),
    } as unknown as PointLedgerRepository;

    const res = await manualOverride(input, ctx, repo);

    expect(res).toEqual({ ledgerId: 'ledger1' });
    expect(repo.applyManualAdjustment).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates the repository error', async () => {
    const repo = {
      applyManualAdjustment: vi.fn().mockRejectedValue(new Error('X')),
    } as unknown as PointLedgerRepository;

    await expect(manualOverride(input, ctx, repo)).rejects.toThrow('X');
  });
});

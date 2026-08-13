import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postAccrual, type BonusLedgerRepository } from '@/modules/bonus-ledger';

beforeEach(() => vi.clearAllMocks());

const ctx = { organizationId: 'o1', userId: 'u1' };
const input = { periodId: 'per1' };

describe('bonus-ledger module — postAccrual', () => {
  it('happy path: passes through the repo result', async () => {
    const repo = {
      postAccrual: vi.fn().mockResolvedValue({ posted: true }),
    } as unknown as BonusLedgerRepository;

    const res = await postAccrual(input, ctx, repo);

    expect(res).toEqual({ posted: true });
    expect(repo.postAccrual).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates the repo error', async () => {
    const repo = {
      postAccrual: vi.fn().mockRejectedValue(new Error('X')),
    } as unknown as BonusLedgerRepository;

    await expect(postAccrual(input, ctx, repo)).rejects.toThrow('X');
  });
});

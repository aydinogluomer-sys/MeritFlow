import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runScan, type AntiGamingRepository } from '@/modules/anti-gaming';

beforeEach(() => vi.clearAllMocks());

const ctx = { organizationId: 'o1' };

describe('anti-gaming module — runScan', () => {
  it('happy path: returns { flagCount } from the injected repo', async () => {
    const repo = { runScan: vi.fn().mockResolvedValue(3) } as unknown as AntiGamingRepository;
    const res = await runScan({ periodId: 'per1' }, ctx, repo);

    expect(res).toEqual({ flagCount: 3 });
    expect(repo.runScan).toHaveBeenCalledWith({ periodId: 'per1' }, ctx);
  });

  it('propagates the repo error', async () => {
    const repo = {
      runScan: vi.fn().mockRejectedValue(new Error('X')),
    } as unknown as AntiGamingRepository;

    await expect(runScan({ periodId: 'per1' }, ctx, repo)).rejects.toThrow('X');
  });
});

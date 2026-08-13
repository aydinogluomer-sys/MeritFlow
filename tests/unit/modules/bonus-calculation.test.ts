import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runCalculation,
  recalculate,
  type BonusCalculationRepository,
} from '@/modules/bonus-calculation';

beforeEach(() => vi.clearAllMocks());

const ctx = { organizationId: 'o1', userId: 'u1' };

function repoWith(over: Partial<Record<'runCalculation' | 'recalculate', unknown>>): BonusCalculationRepository {
  return {
    runCalculation: vi.fn(),
    recalculate: vi.fn(),
    ...over,
  } as unknown as BonusCalculationRepository;
}

describe('bonus-calculation module — runCalculation', () => {
  const input = { periodId: 'per1', poolId: 'pool1', idempotencyKey: 'k1' };

  it('happy path: returns snapshotId from the injected repo', async () => {
    const runCalc = vi.fn().mockResolvedValue('snap1');
    const repo = repoWith({ runCalculation: runCalc });
    const res = await runCalculation(input, ctx, repo);

    expect(res).toEqual({ snapshotId: 'snap1' });
    expect(runCalc).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates the repo error', async () => {
    const repo = repoWith({ runCalculation: vi.fn().mockRejectedValue(new Error('X')) });
    await expect(runCalculation(input, ctx, repo)).rejects.toThrow('X');
  });
});

describe('bonus-calculation module — recalculate', () => {
  const input = { periodId: 'per1' };

  it('happy path: passes through the repo result', async () => {
    const rc = vi.fn().mockResolvedValue({ ok: 1 });
    const repo = repoWith({ recalculate: rc });
    const res = await recalculate(input, ctx, repo);

    expect(res).toEqual({ ok: 1 });
    expect(rc).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates the repo error', async () => {
    const repo = repoWith({ recalculate: vi.fn().mockRejectedValue(new Error('Y')) });
    await expect(recalculate(input, ctx, repo)).rejects.toThrow('Y');
  });
});

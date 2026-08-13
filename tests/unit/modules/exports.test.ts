import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPayout, markPaid, type ExportsRepository } from '@/modules/exports';

beforeEach(() => vi.clearAllMocks());

const ctx = { organizationId: 'o1', userId: 'u1' };

describe('exports module — exportPayout', () => {
  const input = { periodId: 'per1', snapshotId: 'snap1', format: 'csv' as const };

  it('happy path: returns { exportId } from the injected repo', async () => {
    const repo = {
      produceExport: vi.fn().mockResolvedValue('exp1'),
      markPaid: vi.fn(),
    } as unknown as ExportsRepository;

    const res = await exportPayout(input, ctx, repo);

    expect(res).toEqual({ exportId: 'exp1' });
    expect(repo.produceExport).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates the repo error', async () => {
    const repo = {
      produceExport: vi.fn().mockRejectedValue(new Error('X')),
      markPaid: vi.fn(),
    } as unknown as ExportsRepository;

    await expect(exportPayout(input, ctx, repo)).rejects.toThrow('X');
  });
});

describe('exports module — markPaid', () => {
  const input = { periodId: 'per1', exportId: 'exp1' };

  it('happy path: passes through the RAW repo result (no wrapping)', async () => {
    const repo = {
      produceExport: vi.fn(),
      markPaid: vi.fn().mockResolvedValue('ok'),
    } as unknown as ExportsRepository;

    const res = await markPaid(input, ctx, repo);

    expect(res).toBe('ok');
    expect(repo.markPaid).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates the repo error', async () => {
    const repo = {
      produceExport: vi.fn(),
      markPaid: vi.fn().mockRejectedValue(new Error('Y')),
    } as unknown as ExportsRepository;

    await expect(markPaid(input, ctx, repo)).rejects.toThrow('Y');
  });
});

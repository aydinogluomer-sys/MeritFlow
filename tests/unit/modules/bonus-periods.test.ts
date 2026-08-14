import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createPeriod, createPool } from '@/modules/bonus-periods';

const createClientMock = vi.mocked(createClient);

/** from(table).insert().select().single() -> { data, error } */
function mockInsert(data: unknown, error: unknown) {
  const single = vi.fn().mockResolvedValue({ data, error });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, insert };
}

beforeEach(() => vi.clearAllMocks());

const ctx = { organizationId: 'o1', userId: 'u1' };

describe('bonus-periods module — createPeriod', () => {
  const input = { periodType: 'monthly' as const, startsOn: '2026-07-01', endsOn: '2026-07-31' };

  it('happy path: inserts bonus_periods and returns periodId', async () => {
    const { from, insert } = mockInsert({ id: 'per1' }, null);
    const res = await createPeriod(input, ctx);

    expect(res).toEqual({ periodId: 'per1' });
    expect(from).toHaveBeenCalledWith('bonus_periods');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'o1',
        period_type: 'monthly',
        starts_on: '2026-07-01',
        ends_on: '2026-07-31',
        created_by: 'u1',
      }),
    );
  });

  it('DB error propagates', async () => {
    mockInsert(null, { message: 'X' });
    await expect(createPeriod(input, ctx)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

describe('bonus-periods module — createPool', () => {
  const input = { bonusPeriodId: 'per1', amountMinor: 10000000, currency: 'TRY' };

  it('happy path: inserts bonus_pools and returns poolId', async () => {
    const { from, insert } = mockInsert({ id: 'pool1' }, null);
    const res = await createPool(input, ctx);

    expect(res).toEqual({ poolId: 'pool1' });
    expect(from).toHaveBeenCalledWith('bonus_pools');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'o1',
        bonus_period_id: 'per1',
        amount_minor: 10000000,
        currency: 'TRY',
        created_by: 'u1',
      }),
    );
  });

  it('DB error propagates', async () => {
    mockInsert(null, { message: 'Y' });
    await expect(createPool(input, ctx)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

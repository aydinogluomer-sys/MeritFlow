import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createTask, submitTask } from '@/modules/tasks';

const createClientMock = vi.mocked(createClient);

const PV_ID = '55555555-5555-4555-8555-555555555555';
const NEW_ID = '44444444-4444-4444-8444-444444444444';

/** createClient mock: scoring_policy_versions read chain + tasks insert chain. */
function mockClient(opts: { version?: { id: string } | null; taskError?: unknown } = {}) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.version === undefined ? { id: PV_ID } : opts.version, error: null });
  const limit = vi.fn().mockReturnValue({ maybeSingle });
  const order = vi.fn().mockReturnValue({ limit });
  const eqV2 = vi.fn().mockReturnValue({ order });
  const eqV1 = vi.fn().mockReturnValue({ eq: eqV2 });
  const selectVersion = vi.fn().mockReturnValue({ eq: eqV1 });

  const single = vi.fn().mockResolvedValue({ data: { id: NEW_ID }, error: opts.taskError ?? null });
  const selectTask = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select: selectTask });

  const from = vi.fn((table: string) => {
    if (table === 'scoring_policy_versions') return { select: selectVersion };
    if (table === 'tasks') return { insert };
    throw new Error(`unexpected table ${table}`);
  });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, insert };
}

beforeEach(() => vi.clearAllMocks());

const input = {
  title: 'T',
  teamId: '22222222-2222-4222-8222-222222222222',
  complexity: 'medium',
  impact: 'high',
  basePoints: 10,
} as const;
const ctx = { organizationId: 'o1', userId: 'u1' };

describe('tasks module — createTask', () => {
  it('inserts with the published policy version + status=assigned, self-assigns', async () => {
    const { from, insert } = mockClient();
    const res = await createTask(input, ctx);

    expect(res).toEqual({ taskId: NEW_ID });
    expect(from).toHaveBeenCalledWith('scoring_policy_versions');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'o1',
        status: 'assigned',
        assigned_to: 'u1',
        base_points: 10,
        scoring_policy_version_id: PV_ID,
      }),
    );
  });

  it('throws NO_PUBLISHED_SCORING_POLICY (no insert) when none published', async () => {
    const { insert } = mockClient({ version: null });
    await expect(createTask(input, ctx)).rejects.toThrow('NO_PUBLISHED_SCORING_POLICY');
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('tasks module — submitTask', () => {
  it('updates the task to submitted', async () => {
    const eq3 = vi.fn().mockResolvedValue({ error: null });
    const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const update = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ update });
    createClientMock.mockResolvedValue({ from } as never);

    const res = await submitTask({ taskId: 'x' }, { organizationId: 'o1' });
    expect(res).toEqual({ taskId: 'x' });
    expect(from).toHaveBeenCalledWith('tasks');
    expect(update).toHaveBeenCalledWith({ status: 'submitted' });
  });
});

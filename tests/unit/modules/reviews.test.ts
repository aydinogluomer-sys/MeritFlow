import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { reviewTask } from '@/modules/reviews';

const createClientMock = vi.mocked(createClient);

function mockInsert(result: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ insert });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, insert };
}

beforeEach(() => vi.clearAllMocks());

const input = {
  taskId: 't1',
  decision: 'approve',
  quality: 'good',
  timeliness: 'on_time',
  reviewerNote: 'ok',
} as const;
const ctx = { organizationId: 'o1', reviewerId: 'r1' };

describe('reviews module — reviewTask', () => {
  it('inserts task_reviews with reviewer_note (never `notes`)', async () => {
    const { from, insert } = mockInsert({ error: null });
    const res = await reviewTask(input, ctx);

    expect(res).toEqual({ taskId: 't1' });
    expect(from).toHaveBeenCalledWith('task_reviews');
    const payload = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      task_id: 't1',
      organization_id: 'o1',
      reviewer_id: 'r1',
      decision: 'approve',
      quality: 'good',
      timeliness: 'on_time',
      reviewer_note: 'ok',
    });
    expect(payload).not.toHaveProperty('notes');
  });

  it('surfaces the DB error message', async () => {
    mockInsert({ error: { message: 'X' } });
    await expect(reviewTask(input, ctx)).rejects.toThrow('X');
  });
});

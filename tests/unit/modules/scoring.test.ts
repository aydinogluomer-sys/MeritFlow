import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getScoringBreakdown } from '@/modules/scoring';

const createClientMock = vi.mocked(createClient);

/** point_ledger.select().eq().eq().eq().maybeSingle() -> { data, error } */
function mockLedgerRow(row: unknown | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq3 = vi.fn().mockReturnValue({ maybeSingle });
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  createClientMock.mockResolvedValue({ from } as never);
  return { from };
}

beforeEach(() => vi.clearAllMocks());

describe('scoring module — getScoringBreakdown', () => {
  it('happy path: maps the task_approved metadata into a breakdown', async () => {
    const { from } = mockLedgerRow({
      employee_id: 'e1',
      points_delta: 18.75,
      scoring_policy_version_id: 'pv1',
      metadata: {
        base_points: 10,
        complexity_multiplier: 1.25,
        impact_multiplier: 1.5,
        quality_multiplier: 1.0,
        timeliness_multiplier: 1.0,
        revision_penalty_rate: 0,
        final_points: 18.75,
      },
    });

    const res = await getScoringBreakdown('t1', { organizationId: 'o1' });

    expect(from).toHaveBeenCalledWith('point_ledger');
    expect(res).toMatchObject({
      taskId: 't1',
      employeeId: 'e1',
      finalPoints: 18.75,
      complexityMultiplier: 1.25,
      impactMultiplier: 1.5,
      qualityMultiplier: 1.0,
      timelinessFactor: 1.0,
      revisionPenaltyRate: 0,
      basePts: 10,
      policyVersionId: 'pv1',
    });
  });

  it('null path: returns null when the task has no earning row', async () => {
    mockLedgerRow(null);
    const res = await getScoringBreakdown('t1', { organizationId: 'o1' });
    expect(res).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { ReviewTaskSchema, SubmitTaskSchema } from '@/lib/validation/schemas/tasks';
import {
  PostAccrualSchema,
  RecalculateSchema,
  RunCalculationSchema,
  RunScanSchema,
} from '@/lib/validation/schemas/bonus';
import {
  AssignReviewerSchema,
  OpenDisputeSchema,
  ResolveDisputeSchema,
} from '@/lib/validation/schemas/disputes';
import { ExportPayoutSchema, MarkPaidSchema } from '@/lib/validation/schemas/payroll';
import { ManualOverrideSchema } from '@/lib/validation/schemas/points';

// Fixed valid UUIDs for reuse. Distinct values so nothing collides accidentally.
const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const UUID3 = '33333333-3333-4333-8333-333333333333';

describe('ReviewTaskSchema', () => {
  it('accepts a valid approve/good/on_time review', () => {
    const res = ReviewTaskSchema.safeParse({
      taskId: UUID,
      decision: 'approve',
      quality: 'good',
      timeliness: 'on_time',
    });
    expect(res.success).toBe(true);
  });

  it("rejects quality:'adequate' (DB-CHECK enum is poor|acceptable|good|excellent)", () => {
    const res = ReviewTaskSchema.safeParse({
      taskId: UUID,
      decision: 'approve',
      quality: 'adequate',
      timeliness: 'on_time',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'quality')).toBe(true);
    }
  });

  it('rejects an invalid decision', () => {
    const res = ReviewTaskSchema.safeParse({
      taskId: UUID,
      decision: 'maybe',
      quality: 'good',
      timeliness: 'on_time',
    });
    expect(res.success).toBe(false);
  });

  it('rejects an invalid timeliness', () => {
    const res = ReviewTaskSchema.safeParse({
      taskId: UUID,
      decision: 'approve',
      quality: 'good',
      timeliness: 'whenever',
    });
    expect(res.success).toBe(false);
  });

  it('allows reviewerNote to be omitted, null, or a string', () => {
    const base = {
      taskId: UUID,
      decision: 'approve' as const,
      quality: 'good' as const,
      timeliness: 'on_time' as const,
    };
    expect(ReviewTaskSchema.safeParse(base).success).toBe(true);
    expect(ReviewTaskSchema.safeParse({ ...base, reviewerNote: null }).success).toBe(true);
    expect(ReviewTaskSchema.safeParse({ ...base, reviewerNote: 'looks good' }).success).toBe(true);
  });
});

describe('SubmitTaskSchema', () => {
  it('accepts a valid uuid taskId', () => {
    expect(SubmitTaskSchema.safeParse({ taskId: UUID }).success).toBe(true);
  });

  it('rejects a non-uuid taskId', () => {
    expect(SubmitTaskSchema.safeParse({ taskId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('RunCalculationSchema', () => {
  it('accepts periodId + poolId uuids', () => {
    expect(RunCalculationSchema.safeParse({ periodId: UUID, poolId: UUID2 }).success).toBe(true);
  });

  it('rejects when poolId is missing', () => {
    expect(RunCalculationSchema.safeParse({ periodId: UUID }).success).toBe(false);
  });

  it('rejects a non-uuid periodId', () => {
    expect(RunCalculationSchema.safeParse({ periodId: 'x', poolId: UUID2 }).success).toBe(false);
  });
});

describe('PostAccrualSchema', () => {
  it('accepts a valid periodId uuid', () => {
    expect(PostAccrualSchema.safeParse({ periodId: UUID }).success).toBe(true);
  });

  it('rejects a non-uuid periodId', () => {
    expect(PostAccrualSchema.safeParse({ periodId: 'nope' }).success).toBe(false);
  });
});

describe('RecalculateSchema', () => {
  it('accepts a valid periodId uuid', () => {
    expect(RecalculateSchema.safeParse({ periodId: UUID }).success).toBe(true);
  });

  it('rejects a missing periodId', () => {
    expect(RecalculateSchema.safeParse({}).success).toBe(false);
  });
});

describe('RunScanSchema', () => {
  it('accepts a valid periodId uuid', () => {
    expect(RunScanSchema.safeParse({ periodId: UUID }).success).toBe(true);
  });

  it('accepts an omitted periodId (optional)', () => {
    expect(RunScanSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a non-uuid periodId when provided', () => {
    expect(RunScanSchema.safeParse({ periodId: 'bad' }).success).toBe(false);
  });
});

describe('OpenDisputeSchema', () => {
  it("accepts a valid 9-value disputeType ('task_points_too_low')", () => {
    const res = OpenDisputeSchema.safeParse({
      taskId: UUID,
      disputeType: 'task_points_too_low',
    });
    expect(res.success).toBe(true);
  });

  it.each(['scoring', 'bonus', 'other'])(
    "rejects disputeType:'%s' (not in the 9-value enum)",
    (disputeType) => {
      const res = OpenDisputeSchema.safeParse({ taskId: UUID, disputeType });
      expect(res.success).toBe(false);
    },
  );

  it('rejects a non-uuid taskId', () => {
    const res = OpenDisputeSchema.safeParse({
      taskId: 'not-uuid',
      disputeType: 'system_error',
    });
    expect(res.success).toBe(false);
  });
});

describe('AssignReviewerSchema', () => {
  it('accepts disputeId + reviewerId uuids', () => {
    expect(
      AssignReviewerSchema.safeParse({ disputeId: UUID, reviewerId: UUID2 }).success,
    ).toBe(true);
  });

  it('rejects a missing reviewerId', () => {
    expect(AssignReviewerSchema.safeParse({ disputeId: UUID }).success).toBe(false);
  });

  it('rejects a non-uuid disputeId', () => {
    expect(
      AssignReviewerSchema.safeParse({ disputeId: 'x', reviewerId: UUID2 }).success,
    ).toBe(false);
  });
});

describe('ResolveDisputeSchema', () => {
  it('accepts a valid accepted resolution with a long enough decisionNote', () => {
    const res = ResolveDisputeSchema.safeParse({
      disputeId: UUID,
      resolution: 'accepted',
      decisionNote: 'This is a sufficiently long decision note.',
    });
    expect(res.success).toBe(true);
  });

  it('accepts optional pointsDelta + bonusPeriodId', () => {
    const res = ResolveDisputeSchema.safeParse({
      disputeId: UUID,
      resolution: 'rejected',
      decisionNote: 'Rejected after review of the evidence.',
      pointsDelta: 5,
      bonusPeriodId: UUID2,
    });
    expect(res.success).toBe(true);
  });

  it('rejects a resolution outside {accepted, rejected}', () => {
    const res = ResolveDisputeSchema.safeParse({
      disputeId: UUID,
      resolution: 'pending',
      decisionNote: 'Some sufficiently long note here.',
    });
    expect(res.success).toBe(false);
  });

  it('rejects a too-short decisionNote', () => {
    const res = ResolveDisputeSchema.safeParse({
      disputeId: UUID,
      resolution: 'accepted',
      decisionNote: 'x',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'decisionNote')).toBe(true);
    }
  });
});

describe('ExportPayoutSchema', () => {
  it('accepts csv/xlsx formats with uuid ids', () => {
    expect(
      ExportPayoutSchema.safeParse({ periodId: UUID, snapshotId: UUID2, format: 'csv' }).success,
    ).toBe(true);
    expect(
      ExportPayoutSchema.safeParse({ periodId: UUID, snapshotId: UUID2, format: 'xlsx' }).success,
    ).toBe(true);
  });

  it("rejects format:'pdf'", () => {
    const res = ExportPayoutSchema.safeParse({
      periodId: UUID,
      snapshotId: UUID2,
      format: 'pdf',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'format')).toBe(true);
    }
  });

  it('rejects a non-uuid snapshotId', () => {
    expect(
      ExportPayoutSchema.safeParse({ periodId: UUID, snapshotId: 'x', format: 'csv' }).success,
    ).toBe(false);
  });
});

describe('MarkPaidSchema', () => {
  it('accepts periodId + exportId uuids', () => {
    expect(MarkPaidSchema.safeParse({ periodId: UUID, exportId: UUID2 }).success).toBe(true);
  });

  it('rejects a non-uuid exportId', () => {
    expect(MarkPaidSchema.safeParse({ periodId: UUID, exportId: 'x' }).success).toBe(false);
  });
});

describe('ManualOverrideSchema', () => {
  const valid = {
    employeeId: UUID,
    pointsDelta: 5,
    reason: 'Corrective adjustment after review.',
    secondApproverId: UUID2,
  };

  it('accepts a valid override (taskId optional)', () => {
    expect(ManualOverrideSchema.safeParse(valid).success).toBe(true);
    expect(ManualOverrideSchema.safeParse({ ...valid, taskId: UUID3 }).success).toBe(true);
  });

  it('rejects pointsDelta:0 (non-zero refine)', () => {
    const res = ManualOverrideSchema.safeParse({ ...valid, pointsDelta: 0 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'pointsDelta')).toBe(true);
    }
  });

  it("rejects reason:'' (min 1)", () => {
    const res = ManualOverrideSchema.safeParse({ ...valid, reason: '' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === 'reason')).toBe(true);
    }
  });

  it('rejects a missing secondApproverId', () => {
    const { secondApproverId: _omit, ...noApprover } = valid;
    void _omit;
    expect(ManualOverrideSchema.safeParse(noApprover).success).toBe(false);
  });
});

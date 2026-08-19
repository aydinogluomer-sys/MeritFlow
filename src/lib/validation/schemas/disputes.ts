import { z } from 'zod';

export const OpenDisputeSchema = z.object({
  taskId: z.string().uuid(),
  disputeType: z.enum([
    'task_points_too_low',
    'unfair_rejection',
    'quality_score_dispute',
    'missing_task_credit',
    'bonus_calculation_dispute',
    'manager_bias_report',
    'anomaly_false_positive',
    'system_error',
    'clawback_dispute',
  ]),
});

export const AssignReviewerSchema = z.object({
  disputeId: z.string().uuid(),
  reviewerId: z.string().uuid(),
});

export const ResolveDisputeSchema = z.object({
  disputeId: z.string().uuid(),
  resolution: z.enum(['accepted', 'rejected']),
  decisionNote: z.string().min(5).max(2000),
  pointsDelta: z.number().int().optional(),
  bonusPeriodId: z.string().uuid().optional(),
  commandId: z.string().uuid().optional(), // ENGINEERING-15
});

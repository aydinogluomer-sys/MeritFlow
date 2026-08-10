import { z } from 'zod';

export const SubmitTaskSchema = z.object({
  taskId: z.string().uuid(),
});

export const ReviewTaskSchema = z.object({
  taskId: z.string().uuid(),
  decision: z.enum(['approve', 'needs_revision', 'reject']),
  quality: z.enum(['poor', 'acceptable', 'good', 'excellent']),
  timeliness: z.enum(['early', 'on_time', 'late_minor', 'late_major']),
  reviewerNote: z.string().max(2000).nullable().optional(),
});

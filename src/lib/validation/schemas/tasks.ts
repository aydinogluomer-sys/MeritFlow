import { z } from 'zod';

export const SubmitTaskSchema = z.object({
  taskId: z.string().uuid(),
});

/**
 * Create + optionally assign a task. complexity/impact enums mirror the DB CHECKs
 * (0019 tasks_complexity_chk / tasks_impact_chk). base_points must be a non-negative
 * integer (tasks_base_points_nonneg_chk). assignedTo/dueDate are optional; when
 * assignedTo is present the action additionally requires task.assign.
 */
export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  teamId: z.string().uuid(),
  complexity: z.enum(['low', 'medium', 'high', 'critical']),
  impact: z.enum(['low', 'medium', 'high', 'strategic']),
  basePoints: z.number().int().min(0),
  assignedTo: z.string().uuid().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const ReviewTaskSchema = z.object({
  taskId: z.string().uuid(),
  decision: z.enum(['approve', 'needs_revision', 'reject']),
  quality: z.enum(['poor', 'acceptable', 'good', 'excellent']),
  timeliness: z.enum(['early', 'on_time', 'late_minor', 'late_major']),
  reviewerNote: z.string().max(2000).nullable().optional(),
});

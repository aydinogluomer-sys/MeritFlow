'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ReviewTaskSchema } from '@/lib/validation/schemas/tasks';
import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Record a task review. The DB trigger `apply_review_to_task` performs scoring.
 * D3 guard: an 'approve' decision with quality='poor' is forbidden.
 */
export const reviewTask = validatedAction(ReviewTaskSchema, async (input) => {
  // D3: quality=poor cannot be approved.
  if (input.decision === 'approve' && input.quality === 'poor') {
    throw new Error('APPROVE_POOR_FORBIDDEN');
  }

  await requirePermission('task.review');
  const org = await getActiveOrg();
  const user = await getUser();

  const supabase = await createClient();
  const { error } = await supabase.from('task_reviews').insert({
    task_id: input.taskId,
    organization_id: org!.organization_id,
    reviewer_id: user!.id,
    decision: input.decision,
    quality: input.quality,
    timeliness: input.timeliness,
    reviewer_note: input.reviewerNote ?? null,
  });

  if (error) throw new Error(error.message);

  return { taskId: input.taskId };
});

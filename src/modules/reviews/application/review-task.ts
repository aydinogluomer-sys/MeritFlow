import { createClient } from '@/lib/supabase/server';
import { ReviewRepository } from '../repository/review-repository';
import type { ReviewTaskInput, ReviewContext } from '../domain/types';

/**
 * Record a task review. Scoring is performed by the DB trigger apply_review_to_task and is
 * never re-implemented here. The D3 pre-check (approve + quality=poor) is enforced by the
 * calling server action before authz (behavior parity) and by the DB trigger.
 */
export async function reviewTask(
  input: ReviewTaskInput,
  ctx: ReviewContext,
): Promise<{ taskId: string }> {
  const supabase = await createClient();
  const repo = new ReviewRepository(supabase);
  await repo.insert({
    task_id: input.taskId,
    organization_id: ctx.organizationId,
    reviewer_id: ctx.reviewerId,
    decision: input.decision,
    quality: input.quality,
    timeliness: input.timeliness,
    reviewer_note: input.reviewerNote ?? null,
  });
  return { taskId: input.taskId };
}

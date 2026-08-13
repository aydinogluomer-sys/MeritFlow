import { createClient } from '@/lib/supabase/server';
import { DisputeRepository } from '../repository/dispute-repository';
import type { AssignReviewerInput, ReviewerContext } from '../domain/types';

/**
 * Assign a reviewer and move a dispute open → under_review. D9 (reviewer ≠ complainant /
 * decision_owner) is enforced by the DB.
 */
export async function assignReviewer(
  input: AssignReviewerInput,
  ctx: ReviewerContext,
): Promise<{ disputeId: string }> {
  const supabase = await createClient();
  const repo = new DisputeRepository(supabase);
  await repo.assignReviewer(input, ctx);
  return { disputeId: input.disputeId };
}
